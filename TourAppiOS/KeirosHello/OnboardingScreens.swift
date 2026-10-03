import SwiftUI
import AVFoundation

struct TourRootView: View {
    @StateObject private var store = TourStore()

    var body: some View {
        ZStack {
            KeirosColor.navy.ignoresSafeArea()
            switch store.state.step {
            case .splash: SplashScreen(store: store)
            case .permissions: PermissionsScreen(store: store)
            case .propertyCode: PropertyCodeScreen(store: store)
            case .validating: ValidatingScreen(store: store)
            case .download: DownloadScreen(store: store)
            case .overview: OverviewScreen(store: store)
            case .search: SearchScreen(store: store)
            case .routePreview: RoutePreviewScreen(store: store)
            case .navigation: NavigationScreen(store: store)
            case .doorAccess: DoorAccessScreen(store: store)
            case .complete: CompleteScreen(store: store)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .preferredColorScheme(.dark)
    }
}

struct SplashScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        ZStack(alignment: .bottom) {
            HeroBackdrop(url: Photos.splash)
            VStack(alignment: .leading, spacing: 8) {
                Text("SELF-GUIDED PROPERTY TOUR")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(KeirosColor.teal)
                    .tracking(1.4)
                Text("KeirosTour")
                    .font(.system(size: 48, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text("Explore the whole community at your pace — lobby, amenities, and model homes.")
                    .font(.system(size: 17))
                    .foregroundStyle(KeirosColor.text.opacity(0.9))
                    .fixedSize(horizontal: false, vertical: true)
                PrimaryButton(label: "Begin my tour", action: store.goNext, variant: "light")
                    .padding(.top, 12)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct PermissionsScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        ZStack(alignment: .bottom) {
            HeroBackdrop(url: Photos.night)
            VStack { HStack { BackChip(action: store.goBack); Spacer() }; Spacer() }.padding(14)
            SheetCard(title: "Help us guide you", subtitle: "Only used while you’re on this self-guided tour.") {
                info("Location", "Show where you are on the property")
                info("Directions", "Guide you from stop to stop")
                info("Visit timing", "Optional — you can turn this on later")
                PrimaryButton(label: "Continue", action: requestAndContinue).padding(.top, 8)
                Button("Continue without location", action: store.goNext)
                    .font(.system(size: 14)).foregroundStyle(Color.white.opacity(0.72)).frame(maxWidth: .infinity).padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
    }

    private func requestAndContinue() {
        LocationAuth.request()
        store.goNext()
    }

    private func info(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
            Text(body)
                .font(.system(size: 13))
                .foregroundStyle(Color.white.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.white.opacity(0.08))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.14), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct PropertyCodeScreen: View {
    @ObservedObject var store: TourStore
    @State private var scanning = false

    var body: some View {
        Group {
            if scanning {
                QrScanView(onCancel: { scanning = false }, onScanned: { raw in
                    scanning = false
                    store.onQrScanned(raw)
                })
            } else {
                ZStack(alignment: .bottom) {
                    HeroBackdrop(url: Photos.campus)
                    VStack { HStack { BackChip(action: store.goBack); Spacer() }; Spacer() }.padding(14)
                    SheetCard(title: "Join this property tour", subtitle: "Scan the code at the lobby, leasing desk, or model unit door.") {
                        Text("Tour access code")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.white.opacity(0.72))
                        TextField("", text: Binding(get: { store.state.code }, set: store.setCode), prompt: Text("OC-CHI-2026").foregroundColor(Color.white.opacity(0.4)))
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .foregroundStyle(.white)
                            .tint(KeirosColor.teal)
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.black.opacity(0.35))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.18), lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                        Text("Scan the lobby QR. The app reads the property ID from it.")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.white.opacity(0.6))
                            .fixedSize(horizontal: false, vertical: true)
                        if !store.state.scannedPropertyId.isEmpty {
                            Text("Property ID · \(store.state.scannedPropertyId)")
                                .foregroundStyle(KeirosColor.teal)
                                .font(.system(size: 13))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if let error = store.state.codeError {
                            Text(error)
                                .foregroundStyle(Color(red: 0.996, green: 0.792, blue: 0.792))
                                .font(.system(size: 13))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        PrimaryButton(label: "Scan QR code", action: openScanner, variant: "ghost")
                        PrimaryButton(label: "Use demo scan", action: store.useDemoScan, variant: "ghost")
                        PrimaryButton(
                            label: store.state.busy ? "Opening tour…" : "Start with this code",
                            action: store.validateCode,
                            enabled: !store.state.code.trimmingCharacters(in: .whitespaces).isEmpty && !store.state.busy
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
            }
        }
    }

    private func openScanner() {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async { if granted { scanning = true } else { store.setCode(store.state.code); store.state.codeError = "Camera permission is required to scan a QR code." } }
        }
    }
}

struct ValidatingScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        ZStack {
            HeroBackdrop(url: Photos.lobby)
            VStack(spacing: 8) {
                Text("✓").font(.system(size: 28, weight: .bold)).foregroundStyle(KeirosColor.verified)
                    .frame(width: 72, height: 72).background(KeirosColor.verified.opacity(0.15)).clipShape(Circle())
                Text("YOU’RE IN").font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.teal)
                Text(store.state.property?.name ?? "").font(.system(size: 26, weight: .semibold)).foregroundStyle(.white).multilineTextAlignment(.center)
                Text(store.state.property?.address ?? "").foregroundStyle(Color.white.opacity(0.72)).multilineTextAlignment(.center)
                if let id = store.state.property?.propertyId, !id.isEmpty {
                    Text("Property ID · \(id)").foregroundStyle(KeirosColor.teal).multilineTextAlignment(.center)
                }
                if !store.state.firebaseNote.isEmpty {
                    Text(store.state.firebaseNote).font(.system(size: 13)).foregroundStyle(Color.white.opacity(0.72)).multilineTextAlignment(.center)
                }
                Text("Preparing your self-guided tour…").foregroundStyle(Color.white.opacity(0.72)).multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .task {
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            store.goTo(.download)
        }
    }
}

struct DownloadScreen: View {
    @ObservedObject var store: TourStore
    var body: some View {
        ZStack {
            HeroBackdrop(url: Photos.lobby)
            VStack(spacing: 8) {
                Text("GETTING READY").font(.system(size: 12, weight: .bold)).foregroundStyle(KeirosColor.teal)
                Text(store.state.property?.name ?? "Your tour").font(.system(size: 28, weight: .semibold)).foregroundStyle(.white).multilineTextAlignment(.center)
                Text([store.state.property?.city, store.state.property?.state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", "))
                    .foregroundStyle(Color.white.opacity(0.72))
                    .multilineTextAlignment(.center)
                ProgressView(value: Double(store.state.downloadPct), total: 100)
                    .tint(KeirosColor.teal)
                    .frame(maxWidth: 280)
                Text(store.state.downloadLabel).foregroundStyle(Color.white.opacity(0.72)).multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
        .task { store.runDownload() }
    }
}
