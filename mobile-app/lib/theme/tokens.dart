import 'package:flutter/widgets.dart';

/// ---------------------------------------------------------------------------
/// Zero UI design tokens — the mobile half of one design system.
///
/// Every value in this file is copied from the authority dashboard's `:root`
/// block in `dashboard/style.css`. The two applications must not drift, so the
/// mapping is one-to-one and the dashboard token name is kept beside each
/// mobile value. If a colour changes there, it changes here in the same commit.
///
/// The palette is deliberately narrow: graphite surfaces, one warm champagne
/// accent, and four status hues. There is no blue, cyan, purple, indigo or
/// neon anywhere in this system — that is a product rule, not a preference,
/// because the console and the handset must read as one instrument.
/// ---------------------------------------------------------------------------

/// Surfaces, lines and text. Mirrors `html[data-surface="graphite"]`.
abstract final class ZeroSurface {
  /// --bg
  static const Color bg = Color(0xFF08080A);

  /// --panel
  static const Color panel = Color(0xFF131317);

  /// --panel-2
  static const Color panel2 = Color(0xFF17171C);

  /// --panel-3
  static const Color panel3 = Color(0xFF1D1D23);

  /// --panel-hover
  static const Color panelHover = Color(0xFF22222A);

  /// --line
  static const Color line = Color(0xFF24242B);

  /// --line-soft
  static const Color lineSoft = Color(0xFF1C1C22);

  /// --line-strong
  static const Color lineStrong = Color(0xFF33333C);

  /// --text
  static const Color text = Color(0xFFF2F0EC);

  /// --text-2
  static const Color text2 = Color(0xFFA7A49D);

  /// --text-3
  static const Color text3 = Color(0xFF78756E);

  /// --text-4
  static const Color text4 = Color(0xFF55534F);
}

/// The champagne accent — hierarchy and the active state, never decoration.
abstract final class ZeroAccent {
  /// --accent
  static const Color base = Color(0xFFE0BD7E);

  /// --accent-2
  static const Color light = Color(0xFFEECF98);

  /// --accent-strong
  static const Color strong = Color(0xFFC9A55F);

  /// --accent-ink: text drawn on top of the accent
  static const Color ink = Color(0xFF1A1508);

  /// --accent-soft: rgba(224, 189, 126, 0.10)
  static const Color soft = Color(0x1AE0BD7E);

  /// --accent-line: rgba(224, 189, 126, 0.30)
  static const Color line = Color(0x4DE0BD7E);
}

/// The four status hues, each with the dashboard's soft fill and border tone.
///
/// These names are the console's vocabulary and are used for the same states on
/// both sides: ACTIVE emergency, CANCELLED/warning, RESOLVED/healthy, STALE.
abstract final class ZeroStatus {
  // ── --danger: an active emergency ──
  static const Color danger = Color(0xFFDD5A53);
  static const Color dangerSoft = Color(0x1FDD5A53); // rgba(..., 0.12)
  static const Color dangerLine = Color(0x5CDD5A53); // rgba(..., 0.36)

  // ── --warning: cancelled, degraded, needs attention ──
  static const Color warning = Color(0xFFDDA43C);
  static const Color warningSoft = Color(0x1FDDA43C);
  static const Color warningLine = Color(0x57DDA43C); // rgba(..., 0.34)

  // ── --success: safe, resolved, healthy ──
  static const Color success = Color(0xFF3FB37C);
  static const Color successSoft = Color(0x1F3FB37C);
  static const Color successLine = Color(0x573FB37C);

  // ── --stale: inactive, unavailable, unknown ──
  static const Color stale = Color(0xFF8D8D96);
  static const Color staleSoft = Color(0x1F8D8D96);
  static const Color staleLine = Color(0x478D8D96); // rgba(..., 0.28)
}

/// Spacing scale. Mirrors `--s-1` … `--s-6`.
abstract final class ZeroSpace {
  static const double s1 = 4;
  static const double s2 = 8;
  static const double s3 = 12;
  static const double s4 = 16;
  static const double s5 = 20;
  static const double s6 = 28;

  /// --gut / --pad-panel, the dashboard's screen and panel padding.
  static const double gutter = 18;
  static const double padPanel = 16;
}

/// Corner radii. Mirrors `--r-*`.
abstract final class ZeroRadius {
  /// --r-panel
  static const double panel = 14;

  /// --r-card
  static const double card = 12;

  /// --r-ctrl
  static const double control = 9;

  /// --r-tile
  static const double tile = 10;

  /// --r-pill
  static const double pill = 999;

  static const Radius panelR = Radius.circular(panel);
  static const Radius cardR = Radius.circular(card);
  static const Radius controlR = Radius.circular(control);
  static const Radius tileR = Radius.circular(tile);

  static const BorderRadius panelAll = BorderRadius.all(panelR);
  static const BorderRadius cardAll = BorderRadius.all(cardR);
  static const BorderRadius controlAll = BorderRadius.all(controlR);
  static const BorderRadius tileAll = BorderRadius.all(tileR);
  static const BorderRadius pillAll = BorderRadius.all(Radius.circular(pill));
}

/// Motion. Mirrors `--ease-*` and `--t-*`.
///
/// The console has exactly one speed, and so does the handset: entrances and
/// settles share [easeOut], reversible state swaps share [easeInOut], and a
/// press is near-instant so the interface never feels like it is catching up
/// with the operator. Nothing here is decorative — every duration below is
/// attached to a real state change.
abstract final class ZeroMotion {
  static const Curve easeOut = Cubic(0.2, 0, 0.2, 1);
  static const Curve easeInOut = Cubic(0.4, 0, 0.2, 1);

  /// --t-micro: contact feedback.
  static const Duration micro = Duration(milliseconds: 90);

  /// --t-fast: colour, border, small swaps.
  static const Duration fast = Duration(milliseconds: 130);

  /// --t-med: panels, cards, values.
  static const Duration med = Duration(milliseconds: 200);

  /// --t-slow: section and context change.
  static const Duration slow = Duration(milliseconds: 260);

  /// --t-map equivalent: the longest move, reserved for the countdown sweep.
  static const Duration sweep = Duration(milliseconds: 420);
}

/// Type. Archivo for interface text, IBM Plex Mono for anything an operator
/// may compare digit by digit — coordinates, DIGIPIN, ids, timers, counts.
///
/// Both families ship as bundled assets so the handset renders identically with
/// no network, which matters for a device that must work in an emergency.
abstract final class ZeroFont {
  static const String ui = 'Archivo';
  static const String mono = 'IBMPlexMono';
}

/// The shared type scale. Sizes track the dashboard's panel/card/metric text.
abstract final class ZeroType {
  /// Screen titles, e.g. "PASSIVE MONITORING".
  static const TextStyle screenTitle = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 22,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.015 * 22,
    height: 1.15,
    color: ZeroSurface.text,
  );

  /// Panel headings.
  static const TextStyle panelTitle = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 15.5,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.01 * 15.5,
    color: ZeroSurface.text,
  );

  static const TextStyle body = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 13.5,
    fontWeight: FontWeight.w400,
    height: 1.45,
    color: ZeroSurface.text,
  );

  static const TextStyle bodyDim = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.45,
    color: ZeroSurface.text2,
  );

  /// The small uppercase section label used above every group of rows.
  static const TextStyle sectionLabel = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 10.5,
    fontWeight: FontWeight.w600,
    letterSpacing: 1.1,
    color: ZeroSurface.text3,
  );

  /// Field labels inside tiles and rows.
  static const TextStyle fieldLabel = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 10.5,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.8,
    color: ZeroSurface.text3,
  );

  /// Row and tile values.
  static const TextStyle value = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 13.5,
    fontWeight: FontWeight.w600,
    color: ZeroSurface.text,
  );

  /// Monospaced value: coordinates, DIGIPIN, ids.
  static const TextStyle monoValue = TextStyle(
    fontFamily: ZeroFont.mono,
    fontSize: 12.5,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.2,
    color: ZeroSurface.text,
  );

  /// Monospaced micro-caption.
  static const TextStyle monoCaption = TextStyle(
    fontFamily: ZeroFont.mono,
    fontSize: 10.5,
    fontWeight: FontWeight.w400,
    color: ZeroSurface.text3,
  );

  /// Button label.
  static const TextStyle button = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 14,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.4,
  );

  /// Status pill text.
  static const TextStyle pill = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 11.5,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.5,
  );

  /// The verification countdown numeral. Deliberately the largest type in the
  /// app: it is the one number the user must be able to read at arm's length.
  static const TextStyle countdown = TextStyle(
    fontFamily: ZeroFont.ui,
    fontSize: 88,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.03 * 88,
    height: 1,
    color: ZeroSurface.text,
  );
}

/// Component metrics that are shared by more than one widget.
abstract final class ZeroMetrics {
  /// Hairline border width used on every panel, card and control.
  static const double hairline = 1;

  /// Glyph tile in the dossier header, scaled for the handset.
  static const double glyphTile = 38;

  /// Small status dot.
  static const double dot = 8;

  /// Minimum touch target. Android asks for 48; the console's controls are
  /// compact, so anything smaller than this gets padded out to it.
  static const double minTouch = 48;
}
