import SwiftUI

enum KeirosColor {
    static let navy = Color(red: 0.027, green: 0.067, blue: 0.118)
    static let teal = Color(red: 0.078, green: 0.722, blue: 0.651)
    static let blue = Color(red: 0.169, green: 0.490, blue: 0.914)
    static let text = Color(red: 0.918, green: 0.941, blue: 0.973)
    static let secondary = Color(red: 0.612, green: 0.702, blue: 0.800)
    static let muted = Color(red: 0.435, green: 0.518, blue: 0.616)
    static let verified = Color(red: 0.204, green: 0.827, blue: 0.600)
    static let amber = Color(red: 0.961, green: 0.620, blue: 0.043)
    static let danger = Color(red: 0.973, green: 0.443, blue: 0.443)
}

struct PrimaryButton: View {
    var label: String
    var action: () -> Void
    var enabled: Bool = true
    var variant: String = "primary"

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(foreground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(background)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(variant == "ghost" ? KeirosColor.secondary.opacity(0.45) : .clear, lineWidth: 1))
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.45)
    }

    private var foreground: Color {
        switch variant {
        case "teal": return Color(red: 0.016, green: 0.184, blue: 0.180)
        case "light": return Color(red: 0.039, green: 0.086, blue: 0.157)
        default: return .white
        }
    }

    @ViewBuilder private var background: some View {
        switch variant {
        case "teal": LinearGradient(colors: [Color(red: 0.051, green: 0.580, blue: 0.533), KeirosColor.teal], startPoint: .leading, endPoint: .trailing)
        case "light": Color.white
        case "ghost": Color.clear
        default: LinearGradient(colors: [Color(red: 0.102, green: 0.373, blue: 0.749), KeirosColor.blue], startPoint: .leading, endPoint: .trailing)
        }
    }
}

struct BackChip: View {
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text("←").font(.system(size: 18)).foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(Color.black.opacity(0.45))
                .clipShape(Circle())
                .overlay(Circle().stroke(.white.opacity(0.18), lineWidth: 1))
        }
    }
}

struct HeroBackdrop: View {
    var url: String
    var body: some View {
        ZStack {
            AsyncImage(url: URL(string: url)) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                KeirosColor.navy
            }
            LinearGradient(colors: [Color.black.opacity(0.25), KeirosColor.navy.opacity(0.92)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
    }
}

struct SheetCard<Content: View>: View {
    var title: String
    var subtitle: String
    @ViewBuilder var content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Capsule().fill(KeirosColor.secondary.opacity(0.4)).frame(width: 40, height: 4).frame(maxWidth: .infinity)
            Text(title).font(.system(size: 22, weight: .semibold)).foregroundStyle(KeirosColor.text)
            Text(subtitle).font(.system(size: 14)).foregroundStyle(KeirosColor.secondary)
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(KeirosColor.navy.opacity(0.96))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

struct RemoteThumb: View {
    var url: String
    var body: some View {
        AsyncImage(url: URL(string: url)) { image in
            image.resizable().scaledToFill()
        } placeholder: {
            KeirosColor.blue.opacity(0.3)
        }
        .frame(width: 88, height: 88)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }
}
