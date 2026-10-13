import 'package:flutter/material.dart';

import 'tokens.dart';

/// ---------------------------------------------------------------------------
/// The Zero UI theme.
///
/// This deliberately does *not* use `ColorScheme.fromSeed`. A seeded scheme
/// generates tonal palettes from the seed colour, and the generated tones
/// introduce hues this product bans outright — most visibly a purple
/// `surfaceTint` that Material 3 paints over every elevated surface. Instead
/// every role is assigned an explicit token, and `surfaceTint` is transparent
/// so elevation can never tint a graphite panel with a colour nobody chose.
///
/// Ink splashes are disabled globally: the console's press feedback is a 90 ms
/// scale, not a ripple, and a ripple would be the one piece of Material
/// decoration left in the app.
/// ---------------------------------------------------------------------------
ThemeData buildZeroTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.dark,

    // ── primary: the champagne accent ──
    primary: ZeroAccent.base,
    onPrimary: ZeroAccent.ink,
    primaryContainer: ZeroAccent.soft,
    onPrimaryContainer: ZeroAccent.light,

    // ── secondary/tertiary: same family, never a second hue ──
    secondary: ZeroAccent.light,
    onSecondary: ZeroAccent.ink,
    secondaryContainer: ZeroAccent.soft,
    onSecondaryContainer: ZeroAccent.light,
    tertiary: ZeroAccent.strong,
    onTertiary: ZeroAccent.ink,
    tertiaryContainer: ZeroAccent.soft,
    onTertiaryContainer: ZeroAccent.light,

    // ── error: the dashboard's danger red, used for active emergencies ──
    error: ZeroStatus.danger,
    onError: ZeroSurface.bg,
    errorContainer: ZeroStatus.dangerSoft,
    onErrorContainer: ZeroStatus.danger,

    // ── surfaces: graphite, in four steps ──
    surface: ZeroSurface.panel,
    onSurface: ZeroSurface.text,
    surfaceContainerLowest: ZeroSurface.bg,
    surfaceContainerLow: ZeroSurface.panel,
    surfaceContainer: ZeroSurface.panel2,
    surfaceContainerHigh: ZeroSurface.panel3,
    surfaceContainerHighest: ZeroSurface.panelHover,
    onSurfaceVariant: ZeroSurface.text2,
    surfaceTint: Color(0x00000000),

    // ── lines ──
    outline: ZeroSurface.line,
    outlineVariant: ZeroSurface.lineStrong,

    // ── misc ──
    shadow: Color(0x66000000),
    scrim: Color(0xCC000000),
    inverseSurface: ZeroSurface.text,
    onInverseSurface: ZeroSurface.bg,
    inversePrimary: ZeroAccent.strong,
  );

  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    // One uniform material, the same as the console: the scaffold is painted
    // with the panel fill rather than the deeper canvas tone, so screens,
    // sheets and dialogs all read as a single surface instead of a dark
    // margin around a lighter card region (the dashboard fix mirrored here).
    scaffoldBackgroundColor: ZeroSurface.panel,
    canvasColor: ZeroSurface.panel,
    // No Material ink anywhere: press feedback is ours (see ZeroTappable).
    splashFactory: NoSplash.splashFactory,
    splashColor: Colors.transparent,
    highlightColor: Colors.transparent,
    hoverColor: Colors.transparent,
    focusColor: Colors.transparent,
    dividerColor: ZeroSurface.line,
    fontFamily: ZeroFont.ui,
  );

  return base.copyWith(
    textTheme: _textTheme(base.textTheme),
    appBarTheme: const AppBarTheme(
      backgroundColor: ZeroSurface.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: ZeroSurface.text,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: ZeroType.panelTitle,
    ),
    cardTheme: const CardThemeData(
      color: ZeroSurface.panel,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: ZeroRadius.panelAll,
        side: BorderSide(color: ZeroSurface.line, width: ZeroMetrics.hairline),
      ),
    ),
    dividerTheme: const DividerThemeData(
      color: ZeroSurface.line,
      thickness: ZeroMetrics.hairline,
      space: ZeroMetrics.hairline,
    ),
    iconTheme: const IconThemeData(color: ZeroSurface.text2, size: 18),
    listTileTheme: const ListTileThemeData(
      iconColor: ZeroSurface.text2,
      textColor: ZeroSurface.text,
      dense: true,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: ZeroAccent.base,
        foregroundColor: ZeroAccent.ink,
        disabledBackgroundColor: ZeroSurface.panel3,
        disabledForegroundColor: ZeroSurface.text4,
        elevation: 0,
        shadowColor: Colors.transparent,
        padding: const EdgeInsets.symmetric(
          horizontal: ZeroSpace.s5,
          vertical: ZeroSpace.s4,
        ),
        shape: const RoundedRectangleBorder(borderRadius: ZeroRadius.controlAll),
        textStyle: ZeroType.button,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ZeroSurface.text,
        side: const BorderSide(color: ZeroSurface.lineStrong, width: ZeroMetrics.hairline),
        padding: const EdgeInsets.symmetric(
          horizontal: ZeroSpace.s5,
          vertical: ZeroSpace.s4,
        ),
        shape: const RoundedRectangleBorder(borderRadius: ZeroRadius.controlAll),
        textStyle: ZeroType.button,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: ZeroAccent.base,
        textStyle: ZeroType.button,
      ),
    ),
    inputDecorationTheme: const InputDecorationTheme(
      filled: true,
      fillColor: ZeroSurface.panel2,
      isDense: true,
      contentPadding: EdgeInsets.symmetric(
        horizontal: ZeroSpace.s3,
        vertical: ZeroSpace.s3,
      ),
      hintStyle: TextStyle(color: ZeroSurface.text4, fontSize: 13),
      labelStyle: TextStyle(color: ZeroSurface.text3, fontSize: 12),
      border: OutlineInputBorder(
        borderRadius: ZeroRadius.controlAll,
        borderSide: BorderSide(color: ZeroSurface.line, width: ZeroMetrics.hairline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: ZeroRadius.controlAll,
        borderSide: BorderSide(color: ZeroSurface.line, width: ZeroMetrics.hairline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: ZeroRadius.controlAll,
        borderSide: BorderSide(color: ZeroAccent.line, width: ZeroMetrics.hairline),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: ZeroRadius.controlAll,
        borderSide: BorderSide(color: ZeroStatus.dangerLine, width: ZeroMetrics.hairline),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? ZeroAccent.base
            : ZeroSurface.text3,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? ZeroAccent.soft
            : ZeroSurface.panel3,
      ),
      trackOutlineColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? ZeroAccent.line
            : ZeroSurface.lineStrong,
      ),
    ),
    sliderTheme: const SliderThemeData(
      activeTrackColor: ZeroAccent.base,
      inactiveTrackColor: ZeroSurface.panel3,
      thumbColor: ZeroAccent.base,
      overlayColor: ZeroAccent.soft,
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: ZeroAccent.base,
      linearTrackColor: ZeroSurface.panel3,
      circularTrackColor: ZeroSurface.panel3,
    ),
    snackBarTheme: const SnackBarThemeData(
      backgroundColor: ZeroSurface.panel3,
      contentTextStyle: ZeroType.body,
      actionTextColor: ZeroAccent.base,
      behavior: SnackBarBehavior.floating,
      elevation: 0,
    ),
    dialogTheme: const DialogThemeData(
      // One step above the uniform scaffold so a popup reads as floating.
      backgroundColor: ZeroSurface.panel2,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: ZeroRadius.panelAll,
        side: BorderSide(color: ZeroSurface.line, width: ZeroMetrics.hairline),
      ),
      titleTextStyle: ZeroType.panelTitle,
      contentTextStyle: ZeroType.bodyDim,
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: ZeroSurface.panel2,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      showDragHandle: false,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: ZeroRadius.panelR),
      ),
    ),
    popupMenuTheme: const PopupMenuThemeData(
      color: ZeroSurface.panel2,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: ZeroRadius.cardAll,
        side: BorderSide(color: ZeroSurface.line, width: ZeroMetrics.hairline),
      ),
    ),
    tooltipTheme: const TooltipThemeData(
      decoration: BoxDecoration(
        color: ZeroSurface.panel3,
        borderRadius: ZeroRadius.controlAll,
        border: Border.fromBorderSide(
          BorderSide(color: ZeroSurface.line, width: ZeroMetrics.hairline),
        ),
      ),
      textStyle: ZeroType.monoCaption,
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStateProperty.all(ZeroSurface.lineStrong),
      trackColor: WidgetStateProperty.all(Colors.transparent),
      thickness: WidgetStateProperty.all(4),
      radius: const Radius.circular(ZeroRadius.pill),
    ),
  );
}

/// The console's type scale, mapped onto the Material text roles the framework
/// still reaches for internally (dialogs, tooltips, list tiles).
TextTheme _textTheme(TextTheme base) => base.copyWith(
      displayLarge: ZeroType.countdown,
      headlineSmall: ZeroType.screenTitle,
      titleLarge: ZeroType.screenTitle,
      titleMedium: ZeroType.panelTitle,
      titleSmall: ZeroType.sectionLabel,
      bodyLarge: ZeroType.body,
      bodyMedium: ZeroType.body,
      bodySmall: ZeroType.bodyDim,
      labelLarge: ZeroType.button,
      labelMedium: ZeroType.sectionLabel,
      labelSmall: ZeroType.fieldLabel,
    );
