// Print a PDF's page count and per-page text as JSON and render each page to PNG (PDFKit, macOS only).
// Used to compare a Hancom-printed PDF with the browser result. Usage: pdf-pages <file.pdf> <outdir> [dpi]
import Foundation
import PDFKit
import AppKit

let args = CommandLine.arguments
guard args.count >= 3, let document = PDFDocument(url: URL(fileURLWithPath: args[1])) else { print("usage: pdf-pages <file.pdf> <outdir> [dpi]"); exit(2) }
let outdir = URL(fileURLWithPath: args[2]); try? FileManager.default.createDirectory(at: outdir, withIntermediateDirectories: true)
let dpi = args.count > 3 ? Double(args[3]) ?? 110 : 110
var pages: [[String: Any]] = []
for index in 0..<document.pageCount {
  guard let page = document.page(at: index) else { continue }
  let bounds = page.bounds(for: .mediaBox), scale = dpi / 72.0
  let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
  let png = outdir.appendingPathComponent("page-\(index + 1).png")
  if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let data = bitmap.representation(using: .png, properties: [:]) { try? data.write(to: png) }
  pages.append(["index": index + 1, "widthPt": bounds.width, "heightPt": bounds.height, "png": png.path, "text": page.string ?? ""])
}
let json = try! JSONSerialization.data(withJSONObject: ["file": args[1], "pageCount": document.pageCount, "pages": pages], options: [.prettyPrinted, .sortedKeys])
print(String(data: json, encoding: .utf8)!)
