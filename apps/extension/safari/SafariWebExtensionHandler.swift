import AppKit
import Darwin
import Foundation
import SafariServices

private enum TalysmanNativeBridge {
    private static let productionSocket = "/var/run/talysman/talysman.sock"
    private static let developmentSocket = "/tmp/talysman-dev.sock"
    private static let maximumLineBytes = 1024 * 1024

    static func synchronize(message: [String: Any]) -> [String: Any] {
        guard let safari = NSRunningApplication
            .runningApplications(withBundleIdentifier: "com.apple.Safari")
            .first(where: { !$0.isTerminated })
        else {
            return error("Safari process is unavailable")
        }

        let descriptor: Int32
        do {
            descriptor = try connectFirstAvailable()
        } catch {
            return self.error(error.localizedDescription)
        }
        defer { Darwin.close(descriptor) }

        var heartbeat = message
        heartbeat["browser"] = "safari"
        heartbeat["browserPid"] = Int(safari.processIdentifier)

        let requests: [[String: Any]] = [
            ["kind": "request", "id": 1, "method": "getState", "params": NSNull()],
            ["kind": "request", "id": 2, "method": "extHeartbeat", "params": heartbeat],
        ]

        do {
            for request in requests {
                try writeLine(request, to: descriptor)
            }

            var state: [String: Any]?
            var heartbeatAck: [String: Any]?
            for _ in 0..<8 {
                let response = try readLine(from: descriptor)
                guard response["kind"] as? String == "response",
                      response["ok"] as? Bool == true,
                      let id = (response["id"] as? NSNumber)?.intValue,
                      let result = response["result"] as? [String: Any]
                else { continue }

                if id == 1 {
                    let policy = result["policy"] as? [String: Any] ?? [:]
                    state = [
                        "type": "state",
                        "active": result["focusActive"] as? Bool ?? false,
                        "mode": policy["mode"] as? String ?? "blacklist",
                        "domains": policy["domains"] as? [String] ?? [],
                    ]
                } else if id == 2, let heartbeat = result["heartbeat"] as? [String: Any] {
                    heartbeatAck = [
                        "type": "heartbeatAck",
                        "sequence": heartbeat["sequence"] ?? NSNull(),
                        "browserPid": heartbeat["browserPid"] ?? Int(safari.processIdentifier),
                        "healthy": heartbeat["healthy"] ?? false,
                    ]
                }

                if state != nil && heartbeatAck != nil { break }
            }

            guard let state, let heartbeatAck else {
                return error("Talysman service returned an incomplete Safari synchronization response")
            }
            return ["type": "sync", "state": state, "heartbeatAck": heartbeatAck]
        } catch {
            return self.error(error.localizedDescription)
        }
    }

    private static func connectFirstAvailable() throws -> Int32 {
        var lastError = "Talysman service socket is unavailable"
        for path in [productionSocket, developmentSocket] {
            do { return try connect(path: path) }
            catch { lastError = error.localizedDescription }
        }
        throw NSError(domain: "TalysmanSafari", code: 1, userInfo: [NSLocalizedDescriptionKey: lastError])
    }

    private static func connect(path: String) throws -> Int32 {
        let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw posixError("socket") }

        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        withUnsafePointer(to: &timeout) { pointer in
            _ = Darwin.setsockopt(
                descriptor,
                SOL_SOCKET,
                SO_RCVTIMEO,
                pointer,
                socklen_t(MemoryLayout<timeval>.size)
            )
            _ = Darwin.setsockopt(
                descriptor,
                SOL_SOCKET,
                SO_SNDTIMEO,
                pointer,
                socklen_t(MemoryLayout<timeval>.size)
            )
        }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let pathCapacity = MemoryLayout.size(ofValue: address.sun_path)
        let copied = path.withCString { source in
            withUnsafeMutablePointer(to: &address.sun_path) { tuplePointer in
                tuplePointer.withMemoryRebound(to: CChar.self, capacity: pathCapacity) {
                    destination in
                    strlcpy(destination, source, pathCapacity)
                }
            }
        }
        guard copied < pathCapacity else {
            Darwin.close(descriptor)
            throw NSError(
                domain: "TalysmanSafari",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Talysman socket path is too long"]
            )
        }

        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard result == 0 else {
            let failure = posixError("connect \(path)")
            Darwin.close(descriptor)
            throw failure
        }
        return descriptor
    }

    private static func writeLine(_ object: [String: Any], to descriptor: Int32) throws {
        var data = try JSONSerialization.data(withJSONObject: object)
        data.append(0x0A)
        var written = 0
        try data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            while written < data.count {
                let count = Darwin.write(
                    descriptor,
                    bytes.baseAddress!.advanced(by: written),
                    data.count - written
                )
                guard count > 0 else { throw posixError("write") }
                written += count
            }
        }
    }

    private static func readLine(from descriptor: Int32) throws -> [String: Any] {
        var data = Data()
        var byte: UInt8 = 0
        while data.count < maximumLineBytes {
            let count = Darwin.read(descriptor, &byte, 1)
            guard count > 0 else { throw posixError("read") }
            if byte == 0x0A {
                guard let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    throw NSError(
                        domain: "TalysmanSafari",
                        code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "Talysman service returned invalid JSON"]
                    )
                }
                return value
            }
            data.append(byte)
        }
        throw NSError(
            domain: "TalysmanSafari",
            code: 4,
            userInfo: [NSLocalizedDescriptionKey: "Talysman service response exceeded the size limit"]
        )
    }

    private static func posixError(_ operation: String) -> NSError {
        let code = errno
        return NSError(
            domain: NSPOSIXErrorDomain,
            code: Int(code),
            userInfo: [NSLocalizedDescriptionKey: "\(operation) failed: \(String(cString: strerror(code)!))"]
        )
    }

    private static func error(_ message: String) -> [String: Any] {
        ["type": "error", "message": message]
    }
}

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        guard let item = context.inputItems.first as? NSExtensionItem,
              let userInfo = item.userInfo as? [String: Any],
              let message = userInfo[SFExtensionMessageKey] as? [String: Any]
        else {
            context.completeRequest(returningItems: nil, completionHandler: nil)
            return
        }

        DispatchQueue.global(qos: .userInitiated).async {
            let response = NSExtensionItem()
            response.userInfo = [
                SFExtensionMessageKey: TalysmanNativeBridge.synchronize(message: message),
            ]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }
}
