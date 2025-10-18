declare module '@mapbox/point-geometry' {
  export default class Point {
    constructor(x: number, y: number);
    x: number;
    y: number;
    clone(): Point;
    add(p: Point): Point;
    sub(p: Point): Point;
    multByPoint(p: Point): Point;
    divByPoint(p: Point): Point;
    mult(k: number): Point;
    div(k: number): Point;
    rotate(a: number): Point;
    rotateAround(a: number, p: Point): Point;
    matMult(m: [number, number, number, number]): Point;
    unit(): Point;
    perp(): Point;
    round(): Point;
    mag(): number;
    equals(p: Point): boolean;
    dist(p: Point): number;
    distSqr(p: Point): number;
    angle(): number;
    angleTo(p: Point): number;
    angleWith(p: Point): number;
    angleWithSep(x: Point, y: Point): number;
    static convert(points: Array<{ x: number; y: number }>): Point[];
  }
}
