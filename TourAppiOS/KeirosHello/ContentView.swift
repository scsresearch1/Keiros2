import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            Color(red: 0.02, green: 0.05, blue: 0.12)
                .ignoresSafeArea()
            VStack(spacing: 16) {
                Text("Keiros Hello")
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(.white)
                Text("TestFlight setup works.")
                    .font(.title3)
                    .foregroundStyle(.white.opacity(0.85))
            }
            .padding(24)
        }
    }
}
