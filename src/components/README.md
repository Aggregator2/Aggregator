# AnimatedBackground Component

A professional, crypto-inspired animated background built with React Three Fiber, following Uniswap's design principles and best practices for minimal visual noise and optimal performance.

## 🎯 Design Principles

This component follows strict guidelines for professional UI backgrounds:

### 1. **Minimal Visual Noise**
- Limited to 12 tokens on desktop, 6 on mobile
- Ultra-low opacity colors (5-20% opacity range)
- Sparse connecting lines (maximum 8 connections)
- Subtle overlay for enhanced readability

### 2. **Natural Motion**
- Slow, organic movements using sine/cosine functions
- Easing curves (easeInOutSine) for smooth transitions
- Varied speeds per element for natural feel
- Elliptical orbits for more interesting paths

### 3. **Performance Optimized**
- InstancedMesh for efficient token rendering
- Automatic performance mode detection
- Tab visibility awareness (pauses when hidden)
- Reduced quality on mobile devices
- Frame rate targeting at 80%

### 4. **Professional Polish**
- Theme-aware color schemes
- Consistent sizing with proportional scaling
- Soft glows and depth layers
- Responsive breakpoints for all devices

## 📦 Installation

```bash
npm install @react-three/fiber @react-three/drei three
```

## 🚀 Usage

### Basic Implementation

```tsx
import AnimatedBackground from './src/components/AnimatedBackground'

function App() {
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      {/* Background layer */}
      <AnimatedBackground 
        theme="dark"
        density={0.7}
        showOverlay={true}
      />
      
      {/* Your content layer */}
      <div style={{ 
        position: 'relative', 
        zIndex: 10,
        // Your widget styles with backdrop-filter for best effect
        backdropFilter: 'blur(20px) saturate(150%)'
      }}>
        {/* Your dapp content */}
      </div>
    </div>
  )
}
```

### Advanced Configuration

```tsx
<AnimatedBackground 
  theme="dark"              // 'light' | 'dark'
  density={0.7}            // 0.1 to 1.0 (controls element count)
  animationSpeed={0.5}     // 0.1 to 1.0 (controls motion speed)
  showOverlay={true}       // Adds subtle overlay for readability
  className="my-bg"        // Additional CSS class
/>
```

## 🎨 Theme Configuration

The component uses carefully selected low-saturation colors:

### Dark Theme
- Background: Near-black gradient (#0a0a0b → #161618)
- Token colors: 15-20% opacity blues, oranges, purples
- Lines: 10% opacity
- Particles: 15% opacity

### Light Theme  
- Background: Near-white gradient (#fefefe → #f8fafb)
- Token colors: 10-15% opacity versions
- Lines: 8% opacity
- Particles: 10% opacity

## 🛠️ Customization

### Custom Theme

```tsx
import { themes } from './AnimatedBackground'

// Extend with your brand colors
themes.custom = {
  background: 'linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%)',
  tokenColors: ['#00ff8820', '#ff008820', '#8800ff20'],
  lineColor: '#ffffff10',
  waveColor: '#ffffff08', 
  particleColor: '#ffffff15',
  glowColor: '#ffffff08',
  overlayOpacity: 0.02
}
```

### Performance Tuning

```tsx
// For low-end devices
<AnimatedBackground 
  density={0.3}        // Fewer elements
  animationSpeed={0.3} // Slower animations
/>

// For high-end devices
<AnimatedBackground 
  density={1.0}        // Maximum elements
  animationSpeed={0.7} // Faster animations
/>
```

## 📱 Responsive Behavior

The component automatically adjusts based on viewport:

- **Mobile (<768px)**: 6 tokens, 8 particles, reduced orbit radius
- **Tablet (768-1024px)**: Balanced performance settings
- **Desktop (>1024px)**: Full experience with 12 tokens, 16 particles

## ♿ Accessibility

- Respects `prefers-reduced-motion` system setting
- Never interferes with pointer events
- Provides overlay option for enhanced readability
- Pauses animations when tab is not visible

## 🚀 Performance Features

1. **Smart Rendering**
   - Uses InstancedMesh for tokens
   - Caps device pixel ratio at 1.5x
   - Disables antialiasing for better FPS

2. **Adaptive Quality**
   - Detects connection speed
   - Reduces elements on low-end devices
   - Switches to on-demand rendering when needed

3. **Optimization Techniques**
   - GPU acceleration hints
   - Layout containment
   - Efficient buffer updates

## 💡 Best Practices

1. **Always use with backdrop-filter**
   ```css
   .your-widget {
     backdrop-filter: blur(20px) saturate(150%);
     -webkit-backdrop-filter: blur(20px) saturate(150%);
   }
   ```

2. **Position your content properly**
   ```tsx
   <div style={{ position: 'relative', zIndex: 10 }}>
     {/* Your content */}
   </div>
   ```

3. **Test on multiple devices**
   - Check performance on older phones
   - Verify readability in both themes
   - Test with reduced motion enabled

## 🐛 Troubleshooting

### Performance Issues
- Reduce `density` prop
- Ensure hardware acceleration is enabled
- Check for other heavy components

### Visual Issues
- Toggle `showOverlay` for better contrast
- Adjust theme colors for your brand
- Verify backdrop-filter support

### Build Issues
- Ensure Three.js peer dependencies match
- Check TypeScript configuration for JSX
- Verify webpack/build tool WebGL support

## 📚 References

Inspired by:
- [Uniswap Interface](https://github.com/Uniswap/interface)
- [RainbowKit](https://www.rainbowkit.com/)
- [Vercel Dashboard](https://vercel.com/dashboard)

Built with:
- [React Three Fiber](https://github.com/pmndrs/react-three-fiber)
- [Drei](https://github.com/pmndrs/drei)
- [Three.js](https://threejs.org/)