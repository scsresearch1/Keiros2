import SwiftUI
import MapKit
import AVFoundation
struct OutdoorMapView: UIViewRepresentable {
    var route: OutdoorRoute
    var active: JourneyStep?
    var weather: String
    var traffic: String

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.overrideUserInterfaceStyle = .dark
        map.pointOfInterestFilter = .includingAll
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.removeOverlays(map.overlays)
        map.removeAnnotations(map.annotations)
        map.addOverlay(RouteOverlay(points: route.drivePath, color: UIColor(red: 0.13, green: 0.77, blue: 0.37, alpha: 1), dashed: false))
        map.addOverlay(RouteOverlay(points: route.walkPath, color: UIColor(red: 0.22, green: 0.74, blue: 0.97, alpha: 1), dashed: true))
        map.addAnnotation(Pin(title: "Start", coordinate: CLLocationCoordinate2D(latitude: route.originLat, longitude: route.originLng)))
        map.addAnnotation(Pin(title: "Parking", coordinate: CLLocationCoordinate2D(latitude: route.parkingLat, longitude: route.parkingLng)))
        map.addAnnotation(Pin(title: "Entrance", coordinate: CLLocationCoordinate2D(latitude: route.entranceLat, longitude: route.entranceLng)))
        if let active, active.phase != "indoor" {
            map.addAnnotation(Pin(title: active.phase.capitalized, coordinate: CLLocationCoordinate2D(latitude: active.latitude, longitude: active.longitude)))
        }
        let center = CLLocationCoordinate2D(latitude: route.parkingLat, longitude: route.parkingLng)
        if map.region.span.latitudeDelta > 1 || map.region.span.latitudeDelta == 0 {
            map.setRegion(MKCoordinateRegion(center: center, span: MKCoordinateSpan(latitudeDelta: 0.02, longitudeDelta: 0.02)), animated: false)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let route = overlay as? RouteOverlay else { return MKOverlayRenderer(overlay: overlay) }
            let renderer = RouteRenderer(overlay: route)
            return renderer
        }
    }
}

final class Pin: NSObject, MKAnnotation {
    let title: String?
    let coordinate: CLLocationCoordinate2D
    init(title: String, coordinate: CLLocationCoordinate2D) {
        self.title = title
        self.coordinate = coordinate
    }
}

final class RouteOverlay: NSObject, MKOverlay {
    let polyline: MKPolyline
    let color: UIColor
    let dashed: Bool
    var coordinate: CLLocationCoordinate2D { polyline.coordinate }
    var boundingMapRect: MKMapRect { polyline.boundingMapRect }

    init(points: [(Double, Double)], color: UIColor, dashed: Bool) {
        var coords = points.map { CLLocationCoordinate2D(latitude: $0.0, longitude: $0.1) }
        polyline = MKPolyline(coordinates: &coords, count: coords.count)
        self.color = color
        self.dashed = dashed
    }
}

final class RouteRenderer: MKOverlayRenderer {
    override func draw(_ mapRect: MKMapRect, zoomScale: MKZoomScale, in context: CGContext) {
        guard let overlay = overlay as? RouteOverlay else { return }
        let path = CGMutablePath()
        let points = overlay.polyline.points()
        for index in 0..<overlay.polyline.pointCount {
            let point = point(for: points[index])
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        context.addPath(path)
        context.setStrokeColor(overlay.color.cgColor)
        context.setLineWidth(6 / zoomScale)
        context.setLineCap(.round)
        if overlay.dashed {
            context.setLineDash(phase: 0, lengths: [14 / zoomScale, 10 / zoomScale])
        }
        context.strokePath()
    }
}

struct QrScanView: View {
    var onCancel: () -> Void
    var onScanned: (String) -> Void
    @StateObject private var camera = QrCamera()

    var body: some View {
        ZStack {
            QrPreview(session: camera.session).ignoresSafeArea()
            VStack {
                HStack {
                    Button("Cancel", action: onCancel).foregroundStyle(.white).padding()
                    Spacer()
                }
                Spacer()
                Text("Point the camera at the property QR")
                    .foregroundStyle(.white)
                    .padding(.bottom, 28)
            }
        }
        .onAppear { camera.start(onScanned) }
        .onDisappear { camera.stop() }
    }
}

final class QrCamera: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate {
    let session = AVCaptureSession()
    private var handler: ((String) -> Void)?
    private var handled = false

    func start(_ handler: @escaping (String) -> Void) {
        self.handler = handler
        guard session.inputs.isEmpty else {
            if !session.isRunning { DispatchQueue.global().async { self.session.startRunning() } }
            return
        }
        session.beginConfiguration()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]
        session.commitConfiguration()
        DispatchQueue.global().async { self.session.startRunning() }
    }

    func stop() {
        if session.isRunning { session.stopRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !handled, let code = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first?.stringValue else { return }
        handled = true
        handler?(code)
    }
}

struct QrPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}
