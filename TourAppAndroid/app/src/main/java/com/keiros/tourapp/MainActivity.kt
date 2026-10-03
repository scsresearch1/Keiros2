package com.keiros.tourapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.lifecycle.viewmodel.compose.viewModel
import com.keiros.tourapp.flow.TourStep
import com.keiros.tourapp.flow.TourViewModel
import com.keiros.tourapp.screens.CompleteScreen
import com.keiros.tourapp.screens.DoorAccessScreen
import com.keiros.tourapp.screens.DownloadScreen
import com.keiros.tourapp.screens.NavigationScreen
import com.keiros.tourapp.screens.OverviewScreen
import com.keiros.tourapp.screens.PermissionsScreen
import com.keiros.tourapp.screens.PropertyCodeScreen
import com.keiros.tourapp.screens.RoutePreviewScreen
import com.keiros.tourapp.screens.SearchScreen
import com.keiros.tourapp.screens.SplashScreen
import com.keiros.tourapp.screens.ValidatingScreen
import com.keiros.tourapp.ui.KeirosTheme
import com.keiros.tourapp.ui.Navy

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KeirosTheme {
                val vm: TourViewModel = viewModel()
                val state by vm.state.collectAsState()
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(androidx.compose.ui.graphics.Color(0xFF050B14)),
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(Navy)
                            .windowInsetsPadding(WindowInsets.systemBars)
                            .windowInsetsPadding(WindowInsets.ime),
                    ) {
                        when (state.step) {
                            TourStep.Splash -> SplashScreen(vm::goNext)
                            TourStep.Permissions -> PermissionsScreen(vm::goBack, vm::goNext)
                            TourStep.PropertyCode -> PropertyCodeScreen(state, vm)
                            TourStep.Validating -> ValidatingScreen(state) { vm.goTo(TourStep.Download) }
                            TourStep.Download -> DownloadScreen(state, vm)
                            TourStep.Overview -> OverviewScreen(state, vm)
                            TourStep.Search -> SearchScreen(state, vm)
                            TourStep.RoutePreview -> RoutePreviewScreen(state, vm)
                            TourStep.Navigation -> NavigationScreen(state, vm)
                            TourStep.DoorAccess -> DoorAccessScreen(state, vm)
                            TourStep.Complete -> CompleteScreen(state, vm)
                        }
                    }
                }
            }
        }
    }
}
