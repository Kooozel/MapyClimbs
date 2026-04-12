/**
 * Ambient type declarations for the Mapy.cz SMap library globals.
 * Used by gpx-interceptor-injected.ts (page-context unlisted script).
 */

export interface SMapInstance {
  addLayer(layer: SMapLayerMarker): void;
  removeLayer(layer: SMapLayerMarker): void;
  getCenter(): unknown;
}

export interface SMapLayerMarker {
  enable(): void;
  addMarker(marker: unknown): void;
}

export interface SMapConstructorStatic {
  prototype: Record<string, ((...args: unknown[]) => unknown) | undefined>;
  _climbHooked?: boolean;
  Coords: { fromWGS84(lon: number, lat: number): unknown };
  Layer: { Marker: new () => SMapLayerMarker };
  Marker: new (
    coords: unknown,
    id: string,
    opts: {
      url: HTMLImageElement;
      size: [number, number];
      anchor: { left: number; bottom: number };
      title: string;
    }
  ) => unknown;
}

export interface InjectClimbData {
  category: string;
  distance: number;
  elevation: number;
  markerCoords: { lat: number; lon: number } | null;
}

declare global {
  interface Window {
    SMap?: SMapConstructorStatic;
    __climbMap?: SMapInstance;
    __climbMarkerLayer?: SMapLayerMarker;
  }

  interface XMLHttpRequest {
    _isGPXRequest?: boolean;
  }
}
