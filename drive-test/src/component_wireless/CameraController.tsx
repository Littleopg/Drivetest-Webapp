import { useRef, useState, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'

type Props = {
  speed?: number
}

export const CameraController: React.FC<Props> = ({ speed = 0.2 }) => {
  const { camera } = useThree()
  const orbitRef = useRef<any>(null)

  const [keys, setKeys] = useState({
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
  })

  /* ---------- Keyboard ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) =>
      setKeys(k => ({ ...k, [e.code]: true }))
    const up = (e: KeyboardEvent) =>
      setKeys(k => ({ ...k, [e.code]: false }))

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  /* ---------- Initial camera ---------- */
  useEffect(() => {
    camera.position.set(0, 3, 8)
    orbitRef.current?.target.set(0, 1, 0)
  }, [camera])

  /* ---------- WASD movement ---------- */
  useFrame(() => {
    if (!orbitRef.current) return

    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    dir.y = 0
    dir.normalize()

    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize()

    const move = new THREE.Vector3()

    if (keys.KeyW) move.add(dir)
    if (keys.KeyS) move.sub(dir)
    if (keys.KeyD) move.add(right)
    if (keys.KeyA) move.sub(right)

    if (move.length() > 0) {
      move.normalize().multiplyScalar(speed)
      camera.position.add(move)
      orbitRef.current.target.add(move)
    }
  })

  return (
    <OrbitControls
      ref={orbitRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.4}
      maxPolarAngle={Math.PI / 2.1}
    />
  )
}
