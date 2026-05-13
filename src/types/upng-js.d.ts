declare module 'upng-js' {
    export function decode(buffer: ArrayBuffer): any;
    export function toRGBA8(decoded: any): Uint8Array[];
}
