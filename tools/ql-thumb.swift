// Render the first page of a document through the Quick Look thumbnail extension registered for its type.
// With Hancom Office HWP installed, HWP/HWPX files are rendered by Hancom's own extension, so the image is
// Hancom's parser and renderer at work without opening a window or needing Accessibility permission.
// The extension refuses sizes above roughly 1600 px; keep the default. Only the first page is produced.
// Usage: ql-thumb <input> <output.png> [maxPixels]
import Foundation
import AppKit
import QuickLookThumbnailing

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: ql-thumb <input> <output.png> [maxPixels]"); exit(2) }
let input = URL(fileURLWithPath: args[1]), output = URL(fileURLWithPath: args[2])
let maxPixels = args.count > 3 ? Double(args[3]) ?? 1600 : 1600
let request = QLThumbnailGenerator.Request(fileAt: input, size: CGSize(width: maxPixels, height: maxPixels), scale: 1.0, representationTypes: .thumbnail)
let semaphore = DispatchSemaphore(value: 0)
var status: Int32 = 1
QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { representation, error in
  if let representation = representation {
    let image = representation.nsImage
    if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) {
      do { try png.write(to: output); print("wrote \(output.path) \(bitmap.pixelsWide)x\(bitmap.pixelsHigh) type \(representation.type.rawValue)"); status = 0 }
      catch { print("write error \(error)") }
    } else { print("no bitmap") }
  } else { print("error \(error?.localizedDescription ?? "nil")") }
  semaphore.signal()
}
_ = semaphore.wait(timeout: .now() + 90)
exit(status)
