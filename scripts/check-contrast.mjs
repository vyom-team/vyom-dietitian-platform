/**
 * Design token contrast check.
 *
 * Converts the OKLCH values from `src/app/globals.css` to sRGB and asserts the
 * WCAG contrast ratio for every colour pair the interface actually renders.
 *
 * Run with `npm run check:contrast`. Update the pairs below whenever a token is
 * added or retuned — a colour change that silently breaks contrast is the kind
 * of regression nobody notices until a user reports it.
 *
 * Requirements: 4.5:1 for normal text (WCAG 1.4.3 AA), 3:1 for UI component
 * boundaries and focus indicators (1.4.11).
 */

function oklchToLinearSrgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance([L, C, h]) {
  const linear = oklchToLinearSrgb(L, C, h).map((v) =>
    Math.min(Math.max(v, 0), 1),
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// Values mirror the `:root` and `.dark` blocks in src/app/globals.css.
const light = {
  background: [1, 0, 0],
  foreground: [0.18, 0.012, 200],
  card: [1, 0, 0],
  primary: [0.48, 0.078, 187],
  primaryForeground: [0.985, 0.004, 187],
  muted: [0.968, 0.005, 200],
  mutedForeground: [0.512, 0.014, 200],
  success: [0.52, 0.105, 150],
  successSubtle: [0.962, 0.024, 150],
  warning: [0.52, 0.118, 68],
  warningSubtle: [0.968, 0.036, 82],
  info: [0.53, 0.105, 245],
  infoSubtle: [0.962, 0.022, 245],
  destructive: [0.53, 0.225, 27.325],
  destructiveSubtle: [0.962, 0.018, 27],
};

const dark = {
  background: [0.158, 0.012, 200],
  foreground: [0.975, 0.004, 200],
  card: [0.202, 0.014, 200],
  primary: [0.745, 0.088, 187],
  primaryForeground: [0.185, 0.03, 187],
  muted: [0.268, 0.016, 200],
  mutedForeground: [0.706, 0.015, 200],
  success: [0.706, 0.128, 150],
  successSubtle: [0.272, 0.046, 150],
  warning: [0.782, 0.132, 76],
  warningSubtle: [0.288, 0.05, 76],
  info: [0.712, 0.115, 245],
  infoSubtle: [0.278, 0.046, 245],
  destructive: [0.704, 0.191, 22.216],
  destructiveSubtle: [0.278, 0.048, 27],
};

function pairsFor(theme, name) {
  return [
    [`${name} body text`, theme.foreground, theme.background, 4.5],
    [`${name} text on card`, theme.foreground, theme.card, 4.5],
    [`${name} muted text`, theme.mutedForeground, theme.background, 4.5],
    [`${name} muted text on muted`, theme.mutedForeground, theme.muted, 4.5],
    [`${name} primary button label`, theme.primaryForeground, theme.primary, 4.5],
    [`${name} primary as link text`, theme.primary, theme.background, 4.5],
    [`${name} success pill`, theme.success, theme.successSubtle, 4.5],
    [`${name} warning pill`, theme.warning, theme.warningSubtle, 4.5],
    [`${name} info pill`, theme.info, theme.infoSubtle, 4.5],
    [`${name} destructive pill`, theme.destructive, theme.destructiveSubtle, 4.5],
    [`${name} focus ring`, theme.primary, theme.background, 3],
  ];
}

const pairs = [...pairsFor(light, "light"), ...pairsFor(dark, "dark")];

let failures = 0;

for (const [label, fg, bg, required] of pairs) {
  const ratio = contrast(fg, bg);
  const passed = ratio >= required;
  if (!passed) failures += 1;
  console.log(
    `${passed ? "pass" : "FAIL"}  ${ratio.toFixed(2).padStart(6)}:1  (min ${required})  ${label}`,
  );
}

if (failures > 0) {
  console.error(`\n${failures} contrast pair(s) below the required ratio.`);
  process.exit(1);
}

console.log(`\nAll ${pairs.length} contrast pairs pass.`);
