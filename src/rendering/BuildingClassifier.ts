import { BuildingType } from '../config/buildingTypes';

export class BuildingClassifier {
  static classify(properties: Record<string, any>): number {
    const building = properties.building;
    const type = properties.type;

    if (building === 'cathedral' || building === 'church' || type === 'cathedral' || type === 'church') {
      return BuildingType.GOTHIC;
    }

    if (building === 'industrial' || building === 'warehouse' || building === 'factory' ||
        type === 'industrial' || type === 'warehouse') {
      return BuildingType.INDUSTRIAL;
    }

    return BuildingType.RESIDENTIAL;
  }
}
