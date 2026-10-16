import SwiftUI
import MapKit
import AVFoundation
struct OutdoorMapView: UIViewRepresentable {
    var route: OutdoorRoute
    var active: JourneyStep?
    var weather: String
    var traffic: String
    var followPhone: Bool = false
    var userLatitude: Double?
    var userLongitude: Double?
    var userHeading: Double = -1
    var onRouteUpdate: ((Double, Double, String) -> Void)?

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.overrideUserInterfaceStyle = .dark
        map.pointOfInterestFilter = .includingAll
        map.showsCompass = true
        map.showsBuildings = true
        map.isPitchEnabled = true
        map.isRotateEnabled = true
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let coordinator = context.coordinator
        coordinator.onRouteUpdate = onRouteUpdate
        map.showsUserLocation = followPhone
        map.showsTraffic = followPhone
        replacePins(on: map, coordinator: coordinator)
        if followPhone, let userLatitude, let userLongitude {
            coordinator.clearPlanned(map)
            coordinator.follow(
                map: map,
                user: CLLocationCoordinate2D(latitude: userLatitude, longitude: userLongitude),
                heading: userHeading,
                parking: CLLocationCoordinate2D(latitude: route.parkingLat, longitude: route.parkingLng),
                entrance: CLLocationCoordinate2D(latitude: route.entranceLat, longitude: route.entranceLng)
            )
        } else {
            coordinator.stopFollowing(map)
            replacePlannedRoute(on: map, coordinator: coordinator)
            fitPlannedRoute(on: map, coordinator: coordinator)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    private func replacePins(on map: MKMapView, coordinator: Coordinator) {
        let key = "\(followPhone)-\(route.originLat)-\(route.originLng)-\(route.parkingLat)-\(route.entranceLat)-\(active?.id ?? "")"
        guard coordinator.pinKey != key else { return }
        coordinator.pinKey = key
        map.annotations.filter { $0 is Pin }.forEach { map.removeAnnotation($0) }
        let away = Geo.meters(route.originLat, route.originLng, route.entranceLat, route.entranceLng) / 1609.344
        if !followPhone {
            let start = away >= 4 ? "Start · 5 mi" : "Start"
            map.addAnnotation(Pin(title: start, coordinate: CLLocationCoordinate2D(latitude: route.originLat, longitude: route.originLng)))
        }
        map.addAnnotation(Pin(title: "Parking", coordinate: CLLocationCoordinate2D(latitude: route.parkingLat, longitude: route.parkingLng)))
        map.addAnnotation(Pin(title: "Entrance", coordinate: CLLocationCoordinate2D(latitude: route.entranceLat, longitude: route.entranceLng)))
        if !followPhone, let active, active.phase != "indoor" {
            map.addAnnotation(Pin(title: active.phase.capitalized, coordinate: CLLocationCoordinate2D(latitude: active.latitude, longitude: active.longitude)))
        }
    }

    private func replacePlannedRoute(on map: MKMapView, coordinator: Coordinator) {
        let key = "\(active?.phase ?? "drive")-\(route.originLat)-\(route.originLng)-\(route.drivePath.count)"
        guard coordinator.routeKey != key else { return }
        coordinator.routeKey = key
        map.overlays.filter { $0 is RouteOverlay }.forEach { map.removeOverlay($0) }
        let phase = active?.phase ?? "drive"
        if phase != "walk" {
            map.addOverlay(RouteOverlay(points: route.drivePath, color: UIColor(red: 0.13, green: 0.77, blue: 0.37, alpha: 1), dashed: false))
        }
        map.addOverlay(RouteOverlay(points: route.walkPath, color: UIColor(red: 0.22, green: 0.74, blue: 0.97, alpha: 1), dashed: true))
    }

    private func fitPlannedRoute(on map: MKMapView, coordinator: Coordinator) {
        let phase = active?.phase ?? "drive"
        let key = "\(phase)-\(route.originLat)-\(route.originLng)"
        guard coordinator.fittedKey != key else { return }
        coordinator.fittedKey = key
        let points = phase == "walk" ? route.walkPath : route.drivePath + route.walkPath
        guard !points.isEmpty else { return }
        var rect = MKMapRect.null
        for point in points {
            let mapPoint = MKMapPoint(CLLocationCoordinate2D(latitude: point.0, longitude: point.1))
            rect = rect.union(MKMapRect(x: mapPoint.x, y: mapPoint.y, width: 1, height: 1))
        }
        map.setVisibleMapRect(rect, edgePadding: UIEdgeInsets(top: 72, left: 36, bottom: 72, right: 36), animated: false)
    }

    final class Coordinator: NSObject, MKMapViewDelegate {
        var onRouteUpdate: ((Double, Double, String) -> Void)?
        var fittedKey: String?
        var pinKey: String?
        var routeKey: String?
        private var following = false
        private var routeInFlight = false
        private var routeToken = 0
        private var lastRouteAttempt = Date.distantPast
        private var directions: MKDirections?
        private var lastRouted: CLLocationCoordinate2D?
        private var lastDestination: CLLocationCoordinate2D?
        private var lastCamera: CLLocationCoordinate2D?
        private var lastCameraHeading: CLLocationDirection = -1

        func stopFollowing(_ map: MKMapView) {
            guard following else { return }
            following = false
            directions?.cancel()
            routeToken += 1
            routeInFlight = false
            lastRouted = nil
            lastDestination = nil
            lastCamera = nil
            fittedKey = nil
            routeKey = nil
            map.overlays.filter { $0 is MKPolyline }.forEach { map.removeOverlay($0) }
        }

        func clearPlanned(_ map: MKMapView) {
            map.overlays.filter { $0 is RouteOverlay }.forEach { map.removeOverlay($0) }
        }

        func follow(map: MKMapView, user: CLLocationCoordinate2D, heading: CLLocationDirection, parking: CLLocationCoordinate2D, entrance: CLLocationCoordinate2D) {
            following = true
            let travelHeading = heading >= 0 ? heading : map.camera.heading
            let moved = lastCamera.map { Geo.meters($0.latitude, $0.longitude, user.latitude, user.longitude) } ?? 999
            let turned = abs(travelHeading - lastCameraHeading)
            if moved > 3 || turned > 8 || lastCamera == nil {
                lastCamera = user
                lastCameraHeading = travelHeading
                let ahead = 80.0
                let rad = travelHeading * .pi / 180
                let latScale = 111_320.0
                let lngScale = 111_320.0 * max(cos(user.latitude * .pi / 180), 0.2)
                let look = CLLocationCoordinate2D(
                    latitude: user.latitude + cos(rad) * (ahead / latScale),
                    longitude: user.longitude + sin(rad) * (ahead / lngScale)
                )
                let camera = MKMapCamera(lookingAtCenter: look, fromDistance: 420, pitch: 62, heading: travelHeading)
                map.setCamera(camera, animated: true)
            }
            let toParking = Geo.meters(user.latitude, user.longitude, parking.latitude, parking.longitude)
            let destination = toParking > 220 ? parking : entrance
            let walking = toParking <= 220
            let drifted = lastRouted.map { Geo.meters($0.latitude, $0.longitude, user.latitude, user.longitude) } ?? 999
            let destMoved = lastDestination.map { Geo.meters($0.latitude, $0.longitude, destination.latitude, destination.longitude) } ?? 999
            let retryDue = Date().timeIntervalSince(lastRouteAttempt) > 8
            if routeInFlight && Date().timeIntervalSince(lastRouteAttempt) > 12 {
                routeInFlight = false
            }
            guard !routeInFlight else { return }
            guard lastRouted == nil || destMoved > 20 || (drifted > 28 && retryDue) else { return }
            routeInFlight = true
            lastRouteAttempt = Date()
            lastDestination = destination
            requestRoute(map: map, from: user, to: destination, walking: walking)
        }

        private func requestRoute(map: MKMapView, from: CLLocationCoordinate2D, to: CLLocationCoordinate2D, walking: Bool) {
            directions?.cancel()
            routeToken += 1
            let token = routeToken
            let request = MKDirections.Request()
            request.source = mapItem(from)
            request.destination = mapItem(to)
            request.transportType = walking ? .walking : .automobile
            let query = MKDirections(request: request)
            directions = query
            query.calculate { [weak self, weak map] response, _ in
                DispatchQueue.main.async {
                    guard let self, let map, self.routeToken == token else { return }
                    self.routeInFlight = false
                    self.lastRouted = from
                    if let route = response?.routes.first {
                        self.show(route.polyline, on: map)
                        let instruction = route.steps.first { !$0.instructions.isEmpty }?.instructions
                            ?? (walking ? "Walk toward the entrance" : "Continue toward parking")
                        self.onRouteUpdate?(route.distance, route.expectedTravelTime, instruction)
                    } else {
                        self.showFallback(from: from, to: to, on: map)
                        let meters = Geo.meters(from.latitude, from.longitude, to.latitude, to.longitude)
                        let speed = walking ? 1.35 : 11.0
                        self.onRouteUpdate?(meters, meters / speed, walking ? "Walk toward the entrance" : "Head toward parking")
                    }
                }
            }
        }

        private func mapItem(_ coordinate: CLLocationCoordinate2D) -> MKMapItem {
            MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        }

        private func show(_ polyline: MKPolyline, on map: MKMapView) {
            map.overlays.filter { $0 is MKPolyline }.forEach { map.removeOverlay($0) }
            map.addOverlay(polyline, level: .aboveRoads)
        }

        private func showFallback(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D, on map: MKMapView) {
            var coords = [from, to]
            show(MKPolyline(coordinates: &coords, count: coords.count), on: map)
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard annotation is Pin else { return nil }
            let marker = mapView.dequeueReusableAnnotationView(withIdentifier: "pin") as? MKMarkerAnnotationView
                ?? MKMarkerAnnotationView(annotation: annotation, reuseIdentifier: "pin")
            marker.annotation = annotation
            marker.titleVisibility = .visible
            marker.canShowCallout = true
            marker.markerTintColor = UIColor(red: 0.12, green: 0.46, blue: 0.95, alpha: 1)
            marker.glyphImage = UIImage(systemName: "mappin")
            return marker
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let route = overlay as? RouteOverlay {
                return RouteRenderer(overlay: route)
            }
            if let line = overlay as? MKPolyline {
                let renderer = MKPolylineRenderer(polyline: line)
                renderer.strokeColor = UIColor(red: 0.26, green: 0.52, blue: 0.96, alpha: 1)
                renderer.lineWidth = 8
                renderer.lineCap = .round
                renderer.lineJoin = .round
                return renderer
            }
            return MKOverlayRenderer(overlay: overlay)
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
