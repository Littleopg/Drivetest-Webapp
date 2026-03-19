import { useEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// 1. Define the structure for the floor data we are exporting
export interface FloorData {
  floorNumber: number;
  centerXYZ: THREE.Vector3; // The exact middle of the floor
  baseHeightY: number;      // The physical floor level (bottom of the mesh)
  localXYZ: THREE.Vector3;  // The origin point defined in the 3D software
}

interface BuildingModelProps {
  activeFloor: string
  modelPath: string
  onLoadFloors: (count: number) => void
  scale?: number
  rotation?: [number, number, number]
  onModelLoaded?: (scene: THREE.Object3D) => void;
  // 2. Add a new prop to pass the XYZ data back to the parent
  onFloorDataLoaded?: (floors: FloorData[]) => void; 
}

export function BuildingModel({ 
  activeFloor, 
  modelPath, 
  onLoadFloors, 
  scale = 1, 
  rotation = [0, 0, 0],
  onModelLoaded,
  onFloorDataLoaded 
}: BuildingModelProps) {
  
  const groupRef = useRef<THREE.Group>(null)
  const { nodes } = useGLTF(modelPath) as any

  // 1. Analyze the model structure
  const { floorNodes, maxFloor } = useMemo(() => {
    const detectedFloors: { floor: number; node: THREE.Object3D }[] = []
    const allNames = Object.keys(nodes)
    const addedUUIDs = new Set<string>()
    const floorRegex = /(?:Geom3D[_\s]*)?(\d+)[_\s]*(?:floor|level)|(?:floor|level)[_\s]*(\d+)/i

    allNames.forEach((name) => {
      const match = name.match(floorRegex)
      if (match) {
        const floorNum = parseInt(match[1] || match[2])
        if (!isNaN(floorNum)) {
          let targetNode = nodes[name]

          // Use parent group if parent has the same floor name
          if (targetNode.parent) {
             const parentName = targetNode.parent.name || ""
             const parentMatch = parentName.match(floorRegex)
             if (parentMatch) {
                const parentFloorNum = parseInt(parentMatch[1] || parentMatch[2])
                if (parentFloorNum === floorNum) {
                   targetNode = targetNode.parent
                }
             }
          }

          if (!addedUUIDs.has(targetNode.uuid)) {
            detectedFloors.push({ floor: floorNum, node: targetNode })
            addedUUIDs.add(targetNode.uuid)
          }
        }
      }
    })

    const max = detectedFloors.length > 0 
      ? Math.max(...detectedFloors.map(f => f.floor)) 
      : 0

    return { floorNodes: detectedFloors, maxFloor: max }
  }, [nodes])

  // 2. Extract XYZ and pass data to the parent
  useEffect(() => {
    onLoadFloors(maxFloor > 0 ? maxFloor : 1)

    if (onModelLoaded && groupRef.current) {
      onModelLoaded(groupRef.current)
    }

    // --- NEW: Calculate XYZ for each detected floor ---
    if (onFloorDataLoaded && floorNodes.length > 0) {
       const extractedData: FloorData[] = floorNodes.map(({ floor, node }) => {
          // Calculate the physical bounding box of the floor geometry
          const box = new THREE.Box3().setFromObject(node);
          const center = new THREE.Vector3();
          box.getCenter(center); // Gets the true center (X, Y, Z)

          return {
             floorNumber: floor,
             centerXYZ: center,
             baseHeightY: box.min.y, // The absolute bottom of the floor geometry
             localXYZ: node.position.clone() // Local pivot point
          };
       });

       // Sort floors from lowest to highest
       extractedData.sort((a, b) => a.floorNumber - b.floorNumber);
       
       onFloorDataLoaded(extractedData);
    }

  }, [maxFloor, onLoadFloors, onModelLoaded, onFloorDataLoaded, floorNodes]) 

  const isFloorVisible = (floorNum: number) => {
    if (activeFloor === 'all') return true
    return activeFloor === floorNum.toString()
  }

  
  return (
    <group 
      ref={groupRef} 
      dispose={null} 
      scale={scale} 
      rotation={[rotation[0] , rotation[1], rotation[2]]}
    >
      {floorNodes.length > 0 ? (
        floorNodes.map(({ floor, node }) => (
          <primitive 
            key={node.uuid}
            object={node} 
            visible={isFloorVisible(floor)} 
          />
        ))
      ) : (
        <primitive object={Object.values(nodes)[0] as any} />
      )}
    </group>
  )
}