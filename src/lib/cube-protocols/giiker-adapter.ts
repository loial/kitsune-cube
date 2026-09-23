import { connectSmartPuzzle, type BluetoothPuzzle, type MoveEvent } from 'cubing/bluetooth'
import { BaseAdapter } from './base-adapter'
import type { CubeCapabilities, AdapterConnectOptions, CubeBrand } from './types'

export class GiikerAdapter extends BaseAdapter {
  readonly brand: CubeBrand = 'giiker'
  readonly isExperimental = true
  readonly capabilities: CubeCapabilities = {
    gyroscope: false,
    battery: true,
    facelets: true,
  }

  private puzzle: BluetoothPuzzle | null = null

  async connect(_options: AdapterConnectOptions = {}): Promise<void> {
    if (this._isConnected) {
      return
    }

    this.puzzle = await connectSmartPuzzle()
    this._deviceName = this.puzzle.name?.() ?? 'GiiKER Cube'
    this._isConnected = true

    this.puzzle.addAlgLeafListener((event: MoveEvent) => {
      const move = event.latestAlgLeaf.toString()
      this.emitMove(move, event.timeStamp)
    })

    this.puzzle.addEventListener('disconnect', () => {
      this.emitDisconnect()
      this.puzzle = null
    })
  }

  async disconnect(): Promise<void> {
    if (this.puzzle) {
      this.puzzle.disconnect()
      this.puzzle = null
      this._isConnected = false
      this._deviceName = null
    }
  }

  private getServer(): BluetoothRemoteGATTServer {
    // A helper just to expose the BluetoothPuzzle server notification services
    return (this.puzzle as any).server
  }

  async requestBattery(): Promise<void> {
    // Battery status is acquired by inspecting the B5 value on the AAAA service (confirmed for i3S)
    if (!this.puzzle) {
      return
    }

    const server = this.getServer()
    const service = await server.getPrimaryService(
      '0000aaaa-0000-1000-8000-00805f9b34fb',
    )
    const responseCharacteristic = await service.getCharacteristic(
      '0000aaab-0000-1000-8000-00805f9b34fb',
    )
    const commandCharacteristic = await service.getCharacteristic(
      '0000aaac-0000-1000-8000-00805f9b34fb',
    )

    await responseCharacteristic.startNotifications()

    try {
      const battery = await new Promise<number>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout>

        const handler = (event: Event) => {
          const characteristic =
            event.target as BluetoothRemoteGATTCharacteristic
          const value = characteristic.value

          if (!value || value.byteLength < 2) {
            return
          }

          const bytes = new Uint8Array(value.buffer)

          if (bytes[0] !== 0xb5) {
            return
          }

          clearTimeout(timeout)
          responseCharacteristic.removeEventListener(
            'characteristicvaluechanged',
            handler,
          )
          resolve(bytes[1])
        }

        timeout = setTimeout(() => {
          responseCharacteristic.removeEventListener(
            'characteristicvaluechanged',
            handler,
          )
          reject(new Error('Timed out waiting for GiiKER battery response'))
        }, 2000)

        responseCharacteristic.addEventListener(
          'characteristicvaluechanged',
          handler,
        )

        void commandCharacteristic.writeValueWithoutResponse(
          new Uint8Array([0xb5]),
        )
      })

      this.emitBattery(battery)
    } finally {
      await responseCharacteristic.stopNotifications()
    }
  }

  async requestFacelets(): Promise<void> {
    // Facelets are obtained via getPattern() but not emitted as events
    // in cubing.js - would need to call puzzle.getPattern() and convert
  }
}
