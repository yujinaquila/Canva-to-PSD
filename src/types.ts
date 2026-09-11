export type LayerType = 'text' | 'shape' | 'badge' | 'image' | 'background';

export interface BoundingBox {
  x: number; // in pixels relative to canvas width
  y: number; // in pixels relative to canvas height
  width: number;
  height: number;
}

export interface TextProperties {
  content: string;
  fontFamily: string;
  fontSize: number; // in px
  fontWeight: 'normal' | 'medium' | 'bold' | '800' | '900' | string;
  fontStyle?: 'normal' | 'italic';
  color: string; // hex color e.g. #FF5500
  alignment: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
}

export interface ShapeProperties {
  shapeType: 'rectangle' | 'rounded-rectangle' | 'circle' | 'ellipse' | 'badge' | 'line';
  fillColor: string;
  strokeColor?: string;
  strokeWidth?: number;
  borderRadius?: number;
  opacity?: number;
}

export interface DesignLayer {
  id: string;
  name: string;
  type: LayerType;
  group: 'Typography' | 'Graphics & Accents' | 'Visuals' | 'Background';
  bounds: BoundingBox;
  visible: boolean;
  opacity: number; // 0 to 1
  text?: TextProperties;
  shape?: ShapeProperties;
  imageDataUrl?: string; // transparent cutout or slice data URI
}

export interface CanvaDesignAnalysis {
  title: string;
  width: number;
  height: number;
  aspectRatio: string;
  backgroundColor: string;
  backgroundType: 'solid' | 'gradient' | 'photo';
  gradientColors?: string[];
  gradientAngle?: number;
  layers: DesignLayer[];
  previewUrl: string;
  palette: string[];
}

export interface CanvaFetchResult {
  success: boolean;
  canvaBlocked?: boolean;
  title: string;
  designId?: string;
  previewImageUrl?: string;
  imageBase64?: string;
  width?: number;
  height?: number;
  message?: string;
  url?: string;
}

export interface SampleDesign {
  id: string;
  title: string;
  category: string;
  url: string;
  dimensions: string;
  previewImage: string;
  description: string;
}
