import React, { useRef, useMemo, useCallback, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Text, Sphere, Line, Instances, Instance, Float } from '@react-three/drei'
import * as THREE from 'three'

// Theme configuration with subtle, low-saturation colors
interface Theme {
  background: string
  tokenColors: string[]
  lineColor: string
  waveColor: string
  particleColor: string
  glowColor: string
  overlayOpacity: number
}

const themes: Record<'light' | 'dark', Theme> = {
  dark: {
    background: 'linear-gradient(135deg, #0a0a0b 0%, #121214 50%, #0a0a0b 100%)',
    tokenColors: ['#627eea15', '#f7931a10', '#9945ff15', '#00d4aa10', '#ff6b6b10'],
    lineColor: '#627eea08',
    waveColor: '#627eea06',
    particleColor: '#627eea12',
    glowColor: '#627eea05',
    overlayOpacity: 0.03
  },
  light: {
    background: 'linear-gradient(135deg, #fefefe 0%, #f9fafb 50%, #fefefe 100%)',
    tokenColors: ['#4f46e510', '#f59e0b08', '#8b5cf610', '#10b98108', '#ef444408'],
    lineColor: '#4f46e506',
    waveColor: '#4f46e504',
    particleColor: '#4f46e508',
    glowColor: '#4f46e503',
    overlayOpacity: 0.02
  }
}

// Animation configuration with gentle speeds
const ANIMATION_CONFIG = {
  desktop: {
    tokenCount: 10,      // Reduced from 12 for less visual noise
    particleCount: 12,   // Reduced from 16
    orbitRadius: 5,
    floatAmplitude: 0.15, // Reduced for gentler motion
    rotationSpeed: 0.08,  // Slower rotation
    connectionDistance: 5,
    maxConnections: 6     // Limit connections for less clutter
  },
  mobile: {
    tokenCount: 5,       // Reduced from 6
    particleCount: 6,    // Reduced from 8
    orbitRadius: 3,
    floatAmplitude: 0.1,
    rotationSpeed: 0.05,
    connectionDistance: 3.5,
    maxConnections: 3
  }
}

// Smooth easing functions for natural motion
const easings = {
  // Smooth sine-based easing for floating motion
  easeInOutSine: (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2,
  
  // Cubic easing for gentle acceleration/deceleration
  easeInOutCubic: (t: number): number => 
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  
  // Quad easing for very subtle movements
  easeInOutQuad: (t: number): number =>
    t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

// Crypto token symbols - minimal set
const TOKEN_SYMBOLS = ['₿', 'Ξ', '◊', '◯']

// Performance monitoring hook with FPS tracking
function usePerformanceOptimization() {
  const isTabVisible = useRef(true)
  const performanceMode = useRef<'high' | 'medium' | 'low'>('high')
  const fpsRef = useRef<number[]>([])
  
  useEffect(() => {
    const handleVisibilityChange = () => {
      isTabVisible.current = !document.hidden
    }
    
    // Monitor device performance and connection
    const checkPerformance = () => {
      // Check connection quality
      if ('connection' in navigator) {
        const connection = (navigator as any).connection
        if (connection?.saveData || connection?.effectiveType === '2g') {
          performanceMode.current = 'low'
          return
        }
        if (connection?.effectiveType === '3g') {
          performanceMode.current = 'medium'
          return
        }
      }
      
      // Check device memory if available
      if ('deviceMemory' in navigator) {
        const memory = (navigator as any).deviceMemory
        if (memory < 4) {
          performanceMode.current = 'medium'
        }
      }
    }
    
    document.addEventListener('visibilitychange', handleVisibilityChange)
    checkPerformance()
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
  
  // FPS monitoring for adaptive quality
  const trackFPS = useCallback((fps: number) => {
    fpsRef.current.push(fps)
    if (fpsRef.current.length > 30) {
      fpsRef.current.shift()
    }
    
    // Adjust performance mode based on average FPS
    const avgFPS = fpsRef.current.reduce((a, b) => a + b, 0) / fpsRef.current.length
    if (avgFPS < 30 && performanceMode.current !== 'low') {
      performanceMode.current = 'low'
    } else if (avgFPS < 45 && performanceMode.current === 'high') {
      performanceMode.current = 'medium'
    }
  }, [])
  
  return { 
    isTabVisible: isTabVisible.current, 
    performanceMode: performanceMode.current,
    trackFPS 
  }
}

// Instanced floating tokens with smooth, varied motion
function FloatingTokens({ 
  theme, 
  config,
  isTabVisible,
  animationSpeed = 0.5
}: {
  theme: Theme
  config: typeof ANIMATION_CONFIG.desktop
  isTabVisible: boolean
  animationSpeed: number
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null)
  const timeRef = useRef(0)
  const { clock } = useThree()
  
  // Generate tokens with varied, natural parameters
  const instances = useMemo(() => {
    return Array.from({ length: config.tokenCount }, (_, i) => {
      const angle = (i / config.tokenCount) * Math.PI * 2
      const radius = config.orbitRadius + (Math.random() - 0.5) * 1
      
      return {
        position: [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.6, // Elliptical orbit
          (Math.random() - 0.5) * 1.5
        ] as [number, number, number],
        scale: 0.7 + Math.random() * 0.3, // Consistent sizing
        rotationSpeed: (0.05 + Math.random() * 0.05) * animationSpeed,
        orbitSpeed: (0.1 + Math.random() * 0.1) * animationSpeed,
        floatSpeed: (0.3 + Math.random() * 0.2) * animationSpeed,
        floatOffset: Math.random() * Math.PI * 2,
        color: theme.tokenColors[i % theme.tokenColors.length],
        symbol: TOKEN_SYMBOLS[i % TOKEN_SYMBOLS.length]
      }
    })
  }, [config.tokenCount, config.orbitRadius, theme.tokenColors, animationSpeed])

  useFrame((state, delta) => {
    if (!meshRef.current || !isTabVisible) return
    
    // Smooth time progression
    timeRef.current += delta * 0.5
    
    instances.forEach((instance, i) => {
      const matrix = new THREE.Matrix4()
      
      // Multiple layers of smooth motion
      const orbitAngle = timeRef.current * instance.orbitSpeed
      const floatPhase = timeRef.current * instance.floatSpeed + instance.floatOffset
      
      // Smooth position with multiple sine waves for organic motion
      const orbitX = Math.cos(orbitAngle) * 0.3
      const orbitY = Math.sin(orbitAngle * 0.7) * 0.2
      
      const floatX = Math.sin(floatPhase) * 0.1
      const floatY = Math.sin(floatPhase * 1.3) * config.floatAmplitude
      const floatZ = Math.sin(floatPhase * 0.7) * 0.05
      
      // Combine movements with easing
      const easedFloat = easings.easeInOutSine((Math.sin(floatPhase) + 1) / 2)
      
      const x = instance.position[0] + orbitX + floatX
      const y = instance.position[1] + orbitY + floatY * easedFloat
      const z = instance.position[2] + floatZ
      
      // Gentle rotation with easing
      const rotationPhase = timeRef.current * instance.rotationSpeed
      const rotation = easings.easeInOutCubic((Math.sin(rotationPhase) + 1) / 2) * Math.PI * 0.15
      
      matrix.compose(
        new THREE.Vector3(x, y, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotation, rotation * 0.5)),
        new THREE.Vector3(instance.scale, instance.scale, instance.scale)
      )
      
      meshRef.current?.setMatrixAt(i, matrix)
    })
    
    if (meshRef.current) {
      meshRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      {/* Soft glow spheres */}
      <Instances ref={meshRef} limit={config.tokenCount}>
        <sphereGeometry args={[0.8, 12, 12]} />
        <meshBasicMaterial 
          color={theme.glowColor}
          transparent 
          opacity={0.08}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
        {instances.map((_, i) => (
          <Instance key={i} />
        ))}
      </Instances>
      
      {/* Token symbols with Float for extra smoothness */}
      {instances.map((instance, i) => (
        <Float
          key={i}
          speed={0.5}
          rotationIntensity={0.1}
          floatIntensity={0.1}
        >
          <Text
            position={instance.position}
            fontSize={0.7}
            color={instance.color}
            anchorX="center"
            anchorY="middle"
            font="https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyeMZhrib2Bg-4.woff2"
          >
            {instance.symbol}
          </Text>
        </Float>
      ))}
    </>
  )
}

// Subtle connecting lines with distance-based opacity
function ConnectingLines({ 
  tokens, 
  theme,
  config,
  isTabVisible,
  animationSpeed = 0.5
}: { 
  tokens: Array<{ position: [number, number, number] }>
  theme: Theme
  config: typeof ANIMATION_CONFIG.desktop
  isTabVisible: boolean
  animationSpeed: number
}) {
  const linesRef = useRef<THREE.Group>(null)
  const timeRef = useRef(0)
  
  // Create minimal connections
  const connections = useMemo(() => {
    const lines: Array<{
      points: [THREE.Vector3, THREE.Vector3]
      distance: number
      opacity: number
    }> = []
    
    // Sort by distance and take only closest connections
    const allPairs: Array<{
      i: number
      j: number
      distance: number
    }> = []
    
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const p1 = new THREE.Vector3(...tokens[i].position)
        const p2 = new THREE.Vector3(...tokens[j].position)
        const distance = p1.distanceTo(p2)
        
        if (distance < config.connectionDistance) {
          allPairs.push({ i, j, distance })
        }
      }
    }
    
    // Sort by distance and take only the closest ones
    allPairs.sort((a, b) => a.distance - b.distance)
    const selectedPairs = allPairs.slice(0, config.maxConnections)
    
    selectedPairs.forEach(pair => {
      const p1 = new THREE.Vector3(...tokens[pair.i].position)
      const p2 = new THREE.Vector3(...tokens[pair.j].position)
      const opacity = 1 - (pair.distance / config.connectionDistance)
      
      lines.push({ 
        points: [p1, p2], 
        distance: pair.distance,
        opacity: opacity * 0.3 // Very subtle
      })
    })
    
    return lines
  }, [tokens, config.connectionDistance, config.maxConnections])

  useFrame((state, delta) => {
    if (!linesRef.current || !isTabVisible) return
    
    timeRef.current += delta * animationSpeed * 0.3
    
    // Gentle pulsing with easing
    const pulsePhase = easings.easeInOutSine((Math.sin(timeRef.current) + 1) / 2)
    
    linesRef.current.children.forEach((line, index) => {
      if (line instanceof THREE.Line) {
        const connection = connections[index]
        const baseopacity = connection.opacity
        ;(line.material as THREE.LineBasicMaterial).opacity = 
          baseopacity * (0.8 + pulsePhase * 0.2)
      }
    })
  })

  return (
    <group ref={linesRef}>
      {connections.map((connection, index) => (
        <Line 
          key={index}
          points={connection.points}
          color={theme.lineColor}
          transparent
          opacity={connection.opacity}
          lineWidth={0.5}
          dashed
          dashScale={3}
          dashSize={0.5}
          gapSize={0.5}
        />
      ))}
    </group>
  )
}

// Smooth wave animation with organic motion
function PriceWave({ 
  theme, 
  isTabVisible,
  animationSpeed = 0.5
}: { 
  theme: Theme
  isTabVisible: boolean
  animationSpeed: number
}) {
  const waveRef = useRef<THREE.Mesh>(null)
  const { viewport } = useThree()
  const timeRef = useRef(0)
  
  const waveGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(viewport.width * 1.2, 1, 24, 3)
  }, [viewport.width])

  useFrame((state, delta) => {
    if (!waveRef.current || !isTabVisible) return
    
    timeRef.current += delta * animationSpeed * 0.2
    const positions = waveGeometry.attributes.position.array as Float32Array
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const baseY = -viewport.height / 2 + 0.3
      
      // Multiple sine waves with different frequencies for organic feel
      const wave1 = Math.sin(x * 0.2 + timeRef.current) * 0.08
      const wave2 = Math.sin(x * 0.3 + timeRef.current * 1.1) * 0.05
      const wave3 = Math.sin(x * 0.1 + timeRef.current * 0.7) * 0.03
      
      // Combine with easing for smooth motion
      const combinedWave = easings.easeInOutQuad((wave1 + wave2 + wave3 + 0.16) / 0.32) * 0.2
      
      positions[i + 1] = baseY + combinedWave
    }
    
    waveGeometry.attributes.position.needsUpdate = true
  })

  return (
    <mesh 
      ref={waveRef} 
      geometry={waveGeometry}
      position={[0, 0, -4]}
    >
      <meshBasicMaterial 
        color={theme.waveColor}
        transparent
        opacity={0.2}
        wireframe
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

// Minimal floating particles with gentle drift
function FloatingParticles({ 
  theme, 
  count,
  isTabVisible,
  animationSpeed = 0.5
}: { 
  theme: Theme
  count: number
  isTabVisible: boolean
  animationSpeed: number
}) {
  const particlesRef = useRef<THREE.Points>(null)
  const { viewport } = useThree()
  const timeRef = useRef(0)
  
  const particles = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const phases = new Float32Array(count)
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * viewport.width * 1.2
      positions[i * 3 + 1] = (Math.random() - 0.5) * viewport.height * 1.2
      positions[i * 3 + 2] = (Math.random() - 0.5) * 3
      
      // Very gentle velocities
      velocities[i * 3] = (Math.random() - 0.5) * 0.002 * animationSpeed
      velocities[i * 3 + 1] = Math.random() * 0.003 * animationSpeed + 0.001
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.001 * animationSpeed
      
      phases[i] = Math.random() * Math.PI * 2
    }
    
    return { positions, velocities, phases }
  }, [count, viewport, animationSpeed])

  useFrame((state, delta) => {
    if (!particlesRef.current || !isTabVisible) return
    
    timeRef.current += delta
    const positions = particlesRef.current.geometry.attributes.position.array as Float32Array
    
    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      const phase = particles.phases[i]
      
      // Gentle drift with sine modulation for natural movement
      const driftX = particles.velocities[i3] * Math.sin(timeRef.current * 0.5 + phase)
      const driftY = particles.velocities[i3 + 1]
      const driftZ = particles.velocities[i3 + 2] * Math.cos(timeRef.current * 0.3 + phase)
      
      positions[i3] += driftX
      positions[i3 + 1] += driftY
      positions[i3 + 2] += driftZ
      
      // Smooth wrap-around
      if (positions[i3 + 1] > viewport.height / 2 + 1) {
        positions[i3 + 1] = -viewport.height / 2 - 1
        positions[i3] = (Math.random() - 0.5) * viewport.width * 1.2
      }
      
      // Keep within bounds on X axis
      if (Math.abs(positions[i3]) > viewport.width * 0.7) {
        positions[i3] *= -0.9
      }
    }
    
    particlesRef.current.geometry.attributes.position.needsUpdate = true
  })

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={particles.positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial 
        color={theme.particleColor}
        size={0.015}
        transparent
        opacity={0.3}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation={true}
      />
    </points>
  )
}

// Main 3D Scene with FPS monitoring
function Scene({ 
  theme, 
  performanceMode,
  animationSpeed = 0.5
}: { 
  theme: Theme
  performanceMode: 'high' | 'medium' | 'low'
  animationSpeed: number
}) {
  const { viewport, clock } = useThree()
  const { isTabVisible, trackFPS } = usePerformanceOptimization()
  const lastTime = useRef(0)
  
  // Track FPS
  useFrame(() => {
    const currentTime = clock.getElapsedTime()
    const delta = currentTime - lastTime.current
    if (delta > 0) {
      trackFPS(1 / delta)
    }
    lastTime.current = currentTime
  })
  
  // Responsive configuration with performance adjustments
  const config = useMemo(() => {
    const isMobile = viewport.width < 8
    const baseConfig = isMobile ? ANIMATION_CONFIG.mobile : ANIMATION_CONFIG.desktop
    
    // Adjust based on performance mode
    if (performanceMode === 'low') {
      return {
        ...baseConfig,
        tokenCount: Math.floor(baseConfig.tokenCount * 0.5),
        particleCount: Math.floor(baseConfig.particleCount * 0.4),
        maxConnections: Math.floor(baseConfig.maxConnections * 0.5)
      }
    } else if (performanceMode === 'medium') {
      return {
        ...baseConfig,
        tokenCount: Math.floor(baseConfig.tokenCount * 0.75),
        particleCount: Math.floor(baseConfig.particleCount * 0.6),
        maxConnections: Math.floor(baseConfig.maxConnections * 0.75)
      }
    }
    
    return baseConfig
  }, [viewport.width, performanceMode])

  // Generate token data
  const tokenData = useMemo(() => {
    return Array.from({ length: config.tokenCount }, (_, i) => {
      const angle = (i / config.tokenCount) * Math.PI * 2
      const radius = config.orbitRadius
      
      return {
        position: [
          Math.cos(angle) * radius + (Math.random() - 0.5) * 0.5,
          Math.sin(angle) * radius * 0.6 + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 1.5
        ] as [number, number, number]
      }
    })
  }, [config])

  return (
    <>
      {/* Soft ambient lighting */}
      <ambientLight intensity={0.15} />
      <fog attach="fog" args={[theme.background, 5, 15]} />
      
      {/* Floating tokens with smooth motion */}
      <FloatingTokens 
        theme={theme} 
        config={config}
        isTabVisible={isTabVisible}
        animationSpeed={animationSpeed}
      />
      
      {/* Minimal connecting lines */}
      <ConnectingLines 
        tokens={tokenData} 
        theme={theme}
        config={config}
        isTabVisible={isTabVisible}
        animationSpeed={animationSpeed}
      />
      
      {/* Gentle wave */}
      <PriceWave 
        theme={theme} 
        isTabVisible={isTabVisible}
        animationSpeed={animationSpeed}
      />
      
      {/* Subtle particles */}
      <FloatingParticles 
        theme={theme} 
        count={config.particleCount}
        isTabVisible={isTabVisible}
        animationSpeed={animationSpeed}
      />
    </>
  )
}

// Main AnimatedBackground Component
interface AnimatedBackgroundProps {
  theme?: 'light' | 'dark'
  className?: string
  animationSpeed?: number // 0.1 to 1.0
  density?: number // 0.1 to 1.0
  showOverlay?: boolean
  reduceMotion?: boolean // Accessibility override
}

export default function AnimatedBackground({ 
  theme = 'dark', 
  className,
  animationSpeed = 0.5,
  density = 0.6,
  showOverlay = true,
  reduceMotion = false
}: AnimatedBackgroundProps) {
  const currentTheme = themes[theme]
  const { performanceMode } = usePerformanceOptimization()
  const [isLoaded, setIsLoaded] = React.useState(false)
  
  // Check system reduce motion preference
  const prefersReducedMotion = useMemo(() => {
    if (reduceMotion) return true
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [reduceMotion])
  
  // Adjust animation speed for reduced motion
  const finalAnimationSpeed = prefersReducedMotion ? 0.1 : animationSpeed
  
  // Handle smooth loading
  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 100)
    return () => clearTimeout(timer)
  }, [])
  
  return (
    <div 
      className={`animated-background animated-background--${theme} ${className || ''} ${
        isLoaded ? 'animated-background--loaded' : 'animated-background--loading'
      }`}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: currentTheme.background,
        pointerEvents: 'none',
        zIndex: -1,
        overflow: 'hidden',
        contain: 'layout style paint'
      }}
    >
      <Canvas
        camera={{ 
          position: [0, 0, 10], 
          fov: 45,
          near: 0.1,
          far: 50
        }}
        gl={{ 
          alpha: true, 
          antialias: false,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
          precision: 'mediump'
        }}
        dpr={typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 1.5) : 1}
        performance={{
          min: 0.95, // Target 95% of ideal framerate
          max: 1,
          debounce: 200
        }}
        frameloop={performanceMode === 'low' || prefersReducedMotion ? 'demand' : 'always'}
      >
        <Scene 
          theme={currentTheme} 
          performanceMode={performanceMode}
          animationSpeed={finalAnimationSpeed * density}
        />
      </Canvas>
      
      {/* Subtle overlay for guaranteed readability */}
      {showOverlay && (
        <div 
          className="animated-background__overlay"
          style={{
            position: 'absolute',
            inset: 0,
            background: theme === 'dark' 
              ? `radial-gradient(circle at center, transparent 0%, rgba(0, 0, 0, ${currentTheme.overlayOpacity}) 100%)`
              : `radial-gradient(circle at center, transparent 0%, rgba(255, 255, 255, ${currentTheme.overlayOpacity}) 100%)`,
            pointerEvents: 'none',
            mixBlendMode: theme === 'dark' ? 'multiply' : 'screen'
          }}
        />
      )}
    </div>
  )
}

// Export configuration for customization
export { themes, ANIMATION_CONFIG, easings }
export type { Theme, AnimatedBackgroundProps }