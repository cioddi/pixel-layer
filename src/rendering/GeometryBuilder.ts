export class GeometryBuilder {
  static extrudePolygon(footprint: number[][], height: number): { vertices: number[], normals: number[] } {
    const vertices: number[] = [];
    const normals: number[] = [];

    const topZ = height;
    const bottomZ = 0;

    for (let i = 1; i < footprint.length - 1; i++) {
      vertices.push(
        footprint[0][0], footprint[0][1], topZ,
        footprint[i][0], footprint[i][1], topZ,
        footprint[i + 1][0], footprint[i + 1][1], topZ
      );
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    }

    for (let i = 0; i < footprint.length - 1; i++) {
      const p1 = footprint[i];
      const p2 = footprint[i + 1];

      const dx = p2[0] - p1[0];
      const dy = p2[1] - p1[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = -dy / len;
      const ny = dx / len;

      vertices.push(
        p1[0], p1[1], bottomZ,
        p2[0], p2[1], bottomZ,
        p2[0], p2[1], topZ,

        p1[0], p1[1], bottomZ,
        p2[0], p2[1], topZ,
        p1[0], p1[1], topZ
      );

      for (let j = 0; j < 6; j++) {
        normals.push(nx, ny, 0);
      }
    }

    return { vertices, normals };
  }

  static extrudePolygonWith3D(groundVertices: number[][], topVertices: number[][]): { vertices: number[], normals: number[] } {
    const vertices: number[] = [];
    const normals: number[] = [];

    // Top face triangulation
    for (let i = 1; i < topVertices.length - 1; i++) {
      vertices.push(
        topVertices[0][0], topVertices[0][1], topVertices[0][2],
        topVertices[i][0], topVertices[i][1], topVertices[i][2],
        topVertices[i + 1][0], topVertices[i + 1][1], topVertices[i + 1][2]
      );
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    }

    // Wall faces
    for (let i = 0; i < groundVertices.length - 1; i++) {
      const p1Ground = groundVertices[i];
      const p2Ground = groundVertices[i + 1];
      const p1Top = topVertices[i];
      const p2Top = topVertices[i + 1];

      const dx = p2Ground[0] - p1Ground[0];
      const dy = p2Ground[1] - p1Ground[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = -dy / len;
      const ny = dx / len;

      vertices.push(
        p1Ground[0], p1Ground[1], p1Ground[2],
        p2Ground[0], p2Ground[1], p2Ground[2],
        p2Top[0], p2Top[1], p2Top[2],

        p1Ground[0], p1Ground[1], p1Ground[2],
        p2Top[0], p2Top[1], p2Top[2],
        p1Top[0], p1Top[1], p1Top[2]
      );

      for (let j = 0; j < 6; j++) {
        normals.push(nx, ny, 0);
      }
    }

    return { vertices, normals };
  }

  static createShadowGeometry(footprint: number[][], offset: number = 0.0001): number[] {
    const vertices: number[] = [];

    for (let i = 1; i < footprint.length - 1; i++) {
      vertices.push(
        footprint[0][0], footprint[0][1], offset,
        footprint[i][0], footprint[i][1], offset,
        footprint[i + 1][0], footprint[i + 1][1], offset
      );
    }

    return vertices;
  }
}
