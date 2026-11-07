// Simplified beer color implementation using SRM reference colors
// Replaces complex CIE calculations with lookup table approach

// SRM reference colors (Standard Reference Method)
const SRM_COLORS: string[] = [
  "#FFF4D4", "#FFE699", "#FFD878", "#FFCA5A", "#FFBF42", "#FBB123", "#F8A600", "#F39C00",
  "#EA8F00", "#E58500", "#DE7C00", "#D77200", "#CF6900", "#CB6200", "#C35900", "#BB5100",
  "#B54C00", "#B04500", "#A63E00", "#A13700", "#9B3200", "#952D00", "#8E2900", "#882300",
  "#821E00", "#7B1A00", "#771900", "#701400", "#6A0E00", "#660D00", "#5E0B00", "#5A0A02",
  "#600903", "#520907", "#4C0505", "#470606", "#420607", "#3D0708", "#370607", "#2D0607",
  "#1F0506", "#000000"  // SRM 0-41
]

// Convert EBC to hex color (main function)
export function ebcToHex(ebc: number): string {
  const srm = Math.max(0, Math.min(41, ebc / 1.97)) // EBC to SRM conversion with clamping
  return SRM_COLORS[Math.round(srm)] // Simple rounding instead of complex interpolation
}

// Convert EBC to RGB (for luminance calculations)
export function ebcToRgb(ebc: number): [number, number, number] {
  const hex = ebcToHex(ebc)
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255  
  const b = parseInt(hex.slice(5, 7), 16) / 255
  return [r, g, b]
}

// Determine ideal text color (black or white) for background
export function idealTextColorForBackground(rgb: [number, number, number]): '#000000' | '#ffffff' {
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  return luminance > 0.6 ? '#000000' : '#ffffff'
}

// Generate border color (2 SRM values lighter/darker)
export function borderHexForBackground(rgb: [number, number, number]): string {
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  
  // Simple approach: find current SRM by reverse lookup, then adjust
  const currentHex = `#${Math.round(rgb[0] * 255).toString(16).padStart(2, '0')}${Math.round(rgb[1] * 255).toString(16).padStart(2, '0')}${Math.round(rgb[2] * 255).toString(16).padStart(2, '0')}`
  let currentSrm = SRM_COLORS.findIndex(color => color === currentHex)
  
  // If exact match not found, estimate based on luminance
  if (currentSrm === -1) {
    currentSrm = Math.round(luminance > 0.5 ? (1 - luminance) * 20 : luminance * 41)
  }
  
  // Adjust SRM for border (lighter for dark, darker for light)
  const borderSrm = luminance > 0.5 
    ? Math.min(currentSrm + 2, 41)  // Darker
    : Math.max(currentSrm - 2, 0)   // Lighter
    
  return SRM_COLORS[borderSrm]
}


