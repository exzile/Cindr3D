import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useThemeStore } from '../../../store/themeStore';

export default function SceneTheme() {
  const { gl, scene } = useThree();
  const canvasBg = useThemeStore((s) => s.colors.canvasBg);

  useEffect(() => {
    const color = new THREE.Color(canvasBg);
    gl.setClearColor(color);
    scene.background = color;
  }, [canvasBg, gl, scene]);

  return null;
}
