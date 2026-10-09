export const BRAND_PALETTES = [
  { id: 'violet', label: 'Violet', color: '#5424d8' },
  { id: 'ocean', label: 'Ocean', color: '#1b64d8' },
  { id: 'forest', label: 'Forest', color: '#14804a' },
  { id: 'rose', label: 'Rose', color: '#c03568' },
  { id: 'amber', label: 'Amber', color: '#b36a0a' },
] as const;

export type BrandingPalette = (typeof BRAND_PALETTES)[number]['id'];
export type ConnectionProtocol = 'http' | 'https';

export interface PlatformAccessSettings {
  connectionProtocol: ConnectionProtocol;
  registrationEnabled: boolean;
  registrationAvailable: boolean;
  userLimit: number;
}

export interface PlatformConfiguration extends PlatformAccessSettings {
  platformName: string;
  platformIcon: string | null;
  themePalette: BrandingPalette;
}

export function isBrandingPalette(value: unknown): value is BrandingPalette {
  return BRAND_PALETTES.some((palette) => palette.id === value);
}

export const DEFAULT_PALETTE: BrandingPalette = 'violet';
export const MAX_BRAND_ICON_BYTES = 512 * 1024;
