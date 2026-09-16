#!/usr/bin/env swift
// mic-monitor.swift
// macOS Native Messaging Host：监听系统级麦克风活动，通过 stdin/stdout 与 Chrome 通信。
//
// 协议：Chrome Native Messaging 标准
//   Chrome → host: [uint32 little-endian length][JSON bytes]
//   host → Chrome: [uint32 little-endian length][JSON bytes]
//
// 检测原理：监听默认输入设备的 kAudioDevicePropertyDeviceIsRunningSomewhere
// 属性变化（输入作用域）。只要任何 app（Zoom/飞书/QQ/网页）开始/结束使用麦克风，
// CoreAudio 都会触发回调。

import Foundation
import CoreAudio
import AudioToolbox

// MARK: - Native Messaging helpers

let outputLock = NSLock()

func sendMessage(_ msg: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: msg, options: []) else {
        return
    }
    var length = UInt32(data.count).littleEndian
    let lengthData = withUnsafeBytes(of: &length) { Data($0) }

    // CoreAudio 回调和 stdin 线程可能同时发送消息，必须避免两条消息交错写入。
    outputLock.lock()
    defer { outputLock.unlock() }
    FileHandle.standardOutput.write(lengthData)
    FileHandle.standardOutput.write(data)
}

func readMessage() -> [String: Any]? {
    let stdin = FileHandle.standardInput
    guard let lenData = try? stdin.read(upToCount: 4), lenData.count == 4 else {
        return nil
    }
    let length = lenData.withUnsafeBytes { $0.load(as: UInt32.self) }
    if length == 0 || length > 8 * 1024 * 1024 {
        return nil
    }
    guard let body = try? stdin.read(upToCount: Int(length)), body.count == Int(length) else {
        return nil
    }
    return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
}

// MARK: - CoreAudio monitor

// kAudioObjectPropertyMasterElement 在 Swift 中未被 import，用常量 0（原始定义）
let kMasterElement: AudioObjectPropertyElement = 0

let inputPropAddr = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
    mScope: kAudioObjectPropertyScopeInput,
    mElement: kMasterElement
)

func getInputDevices() -> [AudioDeviceID] {
    var size: UInt32 = 0
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kMasterElement
    )
    let systemObject = AudioObjectID(kAudioObjectSystemObject)
    guard AudioObjectGetPropertyDataSize(systemObject, &addr, 0, nil, &size) == noErr else {
        return []
    }

    let count = Int(size) / MemoryLayout<AudioDeviceID>.stride
    guard count > 0 else { return [] }
    var devices = [AudioDeviceID](repeating: kAudioObjectUnknown, count: count)
    let status = devices.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) -> OSStatus in
        guard let baseAddress = raw.baseAddress else { return -1 }
        return AudioObjectGetPropertyData(systemObject, &addr, 0, nil, &size, baseAddress)
    }
    guard status == noErr else { return [] }
    return devices.filter(hasInputChannels)
}

func hasInputChannels(_ deviceID: AudioDeviceID) -> Bool {
    var size: UInt32 = 0
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyStreamConfiguration,
        mScope: kAudioObjectPropertyScopeInput,
        mElement: kMasterElement
    )
    guard AudioObjectGetPropertyDataSize(deviceID, &addr, 0, nil, &size) == noErr,
          size >= UInt32(MemoryLayout<AudioBufferList>.size) else {
        return false
    }

    var data = Data(count: Int(size))
    let status = data.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) -> OSStatus in
        guard let baseAddress = raw.baseAddress else { return -1 }
        return AudioObjectGetPropertyData(deviceID, &addr, 0, nil, &size, baseAddress)
    }
    guard status == noErr else { return false }

    return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
        guard let baseAddress = raw.baseAddress else { return false }
        let list = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: baseAddress.assumingMemoryBound(to: AudioBufferList.self))
        )
        var channels: UInt32 = 0
        for index in 0..<list.count {
            channels += list[index].mNumberChannels
        }
        return channels > 0
    }
}

func isInputRunning(_ deviceID: AudioDeviceID) -> Bool {
    var running: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    var addr = inputPropAddr
    let status = AudioObjectGetPropertyData(deviceID, &addr, 0, nil, &size, &running)
    return status == noErr && running != 0
}

func isAnyInputRunning() -> Bool {
    getInputDevices().contains(where: isInputRunning)
}

let stateLock = NSLock()
var lastRunning = false

func currentRunning() -> Bool {
    stateLock.lock()
    defer { stateLock.unlock() }
    return lastRunning
}

func updateRunning(_ running: Bool) {
    stateLock.lock()
    let changed = running != lastRunning
    lastRunning = running
    stateLock.unlock()

    guard changed else { return }
    sendMessage(["type": running ? "mic_started" : "mic_stopped"])
    FileHandle.standardError.write(
        "mic state changed: \(running ? "started" : "stopped")\n".data(using: .utf8)!
    )
}

// 监听所有输入设备，而不是只监听默认输入设备。这样应用单独选择 AirPods、USB 麦克风等
// 非默认设备时，也能触发暂停。
var monitoredDevices = Set<AudioDeviceID>()
var listenerBlocks: [AudioDeviceID: AudioObjectPropertyListenerBlock] = [:]

func refreshDeviceListeners() {
    let currentDevices = Set(getInputDevices())

    for deviceID in currentDevices where !monitoredDevices.contains(deviceID) {
        let listener: AudioObjectPropertyListenerBlock = { (_, _) in
            updateRunning(isAnyInputRunning())
        }
        var addr = inputPropAddr
        let status = AudioObjectAddPropertyListenerBlock(
            deviceID,
            &addr,
            DispatchQueue.main,
            listener
        )
        if status == noErr {
            monitoredDevices.insert(deviceID)
            listenerBlocks[deviceID] = listener
        }
    }

    for deviceID in monitoredDevices.subtracting(currentDevices) {
        if let listener = listenerBlocks.removeValue(forKey: deviceID) {
            var addr = inputPropAddr
            AudioObjectRemovePropertyListenerBlock(deviceID, &addr, DispatchQueue.main, listener)
        }
        monitoredDevices.remove(deviceID)
    }

    updateRunning(isAnyInputRunning())
}

// 初始状态
refreshDeviceListeners()
lastRunning = isAnyInputRunning()
sendMessage([
    "type": "init",
    "running": currentRunning(),
    "devices": getInputDevices().map { Int($0) }
])

// 插拔输入设备时重新安装监听器。
let deviceListAddr = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kMasterElement
)
let deviceListListener: AudioObjectPropertyListenerBlock = { (_, _) in
    refreshDeviceListeners()
}

var mutableDeviceListAddr = deviceListAddr
let deviceListStatus = AudioObjectAddPropertyListenerBlock(
    AudioObjectID(kAudioObjectSystemObject),
    &mutableDeviceListAddr,
    DispatchQueue.main,
    deviceListListener
)
if deviceListStatus != noErr {
    sendMessage(["type": "error", "message": "failed to monitor audio device list"])
}

// 某些 macOS/AVFoundation 路径不会发送 DeviceIsRunningSomewhere 的属性回调，
// 轮询作为兜底，保证网页语音、QuickTime、会议软件等都能被发现。
let pollTimer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
pollTimer.schedule(deadline: .now(), repeating: .milliseconds(250))
pollTimer.setEventHandler {
    updateRunning(isAnyInputRunning())
}
pollTimer.resume()

// Chrome → host 消息循环（备用通道，目前只支持 ping）
DispatchQueue.global(qos: .background).async {
    while true {
        guard let msg = readMessage() else {
            // stdin EOF — Chrome 已断开，干净退出
            exit(0)
        }
        if let type = msg["type"] as? String, type == "ping" {
            sendMessage([
                "type": "pong",
                "running": currentRunning(),
                "timestamp": Date().timeIntervalSince1970
            ])
        }
    }
}

// 写日志到 stderr（不影响协议；Chrome 不读 stderr）
FileHandle.standardError.write("mic-monitor started, inputDevices=\(getInputDevices())\n".data(using: .utf8)!)

RunLoop.main.run()
