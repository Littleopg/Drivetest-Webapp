/* fileName: src/component_wireless/Experience.tsx */
import { Suspense } from 'react'
import { Grid, Bounds } from '@react-three/drei' // 1. Import Bounds
import { CameraController } from './CameraController'
import { BuildingModel } from './BuildingModel'

interface ExperienceProps {
  activeFloor: string
  modelPath: string
  onLoadFloors: (count: number) => void
  scale: number
  rotation: [number, number, number]
}

export default function Experience({ activeFloor, modelPath, onLoadFloors, scale, rotation }: ExperienceProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[-6, 8, 2]} intensity={1.2} castShadow />
      <directionalLight position={[6, 8, -2]} intensity={1.0} />

      <CameraController speed={0.1} />
      
      <Grid args={[1, 1]} cellSize={1} sectionSize={1} position={[0, -0.01, 0]} />

          <BuildingModel 
            activeFloor={activeFloor} 
            modelPath={modelPath}
            onLoadFloors={onLoadFloors}
            scale={scale}
            rotation={rotation}
          />

    </>
  )
}