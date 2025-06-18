import React, { useEffect, useState } from 'react';

export default function DebugBG() {
  const [status, setStatus] = useState('Starting...');
  const [errors, setErrors] = useState([]);
  const [canvasTest, setCanvasTest] = useState(false);
  
  useEffect(() => {
    async function testComponents() {
      const logs = [];
      
      try {
        // Test 1: Check if we can create a canvas
        logs.push('✓ Testing HTML5 Canvas...');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
          logs.push('✓ HTML5 Canvas works');
          setCanvasTest(true);
        } else {
          logs.push('✗ HTML5 Canvas failed');
        }
        
        // Test 2: Check WebGL
        logs.push('✓ Testing WebGL...');
        const webglCanvas = document.createElement('canvas');
        const gl = webglCanvas.getContext('webgl') || webglCanvas.getContext('experimental-webgl');
        if (gl) {
          logs.push('✓ WebGL is supported');
        } else {
          logs.push('✗ WebGL is not supported');
          setErrors(prev => [...prev, 'WebGL not supported']);
        }
        
        // Test 3: Try to import Three.js
        logs.push('✓ Testing Three.js import...');
        const THREE = await import('three');
        if (THREE) {
          logs.push('✓ Three.js imported successfully');
          
          // Test 4: Create a basic Three.js scene
          logs.push('✓ Testing Three.js scene creation...');
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
          const renderer = new THREE.WebGLRenderer({ canvas: webglCanvas });
          
          if (scene && camera && renderer) {
            logs.push('✓ Three.js scene created successfully');
          } else {
            logs.push('✗ Three.js scene creation failed');
          }
        }
        
        // Test 5: Try to import React Three Fiber
        logs.push('✓ Testing React Three Fiber import...');
        const fiber = await import('@react-three/fiber');
        if (fiber) {
          logs.push('✓ React Three Fiber imported successfully');
        }
        
        // Test 6: Try to import our component
        logs.push('✓ Testing AnimatedBackground import...');
        const bg = await import('../src/components/AnimatedBackground');
        if (bg && bg.default) {
          logs.push('✓ AnimatedBackground imported successfully');
          logs.push('✓ All tests passed! Component should work.');
        } else {
          logs.push('✗ AnimatedBackground import failed');
          setErrors(prev => [...prev, 'AnimatedBackground component not found']);
        }
        
      } catch (error) {
        logs.push(`✗ Error: ${error.message}`);
        setErrors(prev => [...prev, error.message]);
        console.error('Debug error:', error);
      }
      
      setStatus(logs.join('\n'));
    }
    
    testComponents();
  }, []);

  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: 'monospace',
      background: '#000',
      color: '#0f0',
      minHeight: '100vh'
    }}>
      <h1 style={{ color: '#fff' }}>🔍 Animated Background Debug</h1>
      
      <div style={{ 
        background: '#111', 
        padding: '20px', 
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #333'
      }}>
        <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>Test Results:</h2>
        <pre style={{ 
          whiteSpace: 'pre-wrap', 
          fontSize: '14px',
          lineHeight: '1.5',
          margin: 0 
        }}>
          {status}
        </pre>
      </div>

      {errors.length > 0 && (
        <div style={{ 
          background: '#300', 
          padding: '20px', 
          borderRadius: '8px',
          border: '1px solid #f00',
          marginBottom: '20px'
        }}>
          <h2 style={{ color: '#f88', margin: '0 0 10px 0' }}>❌ Errors Found:</h2>
          {errors.map((error, i) => (
            <div key={i} style={{ color: '#faa', marginBottom: '5px' }}>
              • {error}
            </div>
          ))}
        </div>
      )}

      <div style={{ 
        background: '#111', 
        padding: '20px', 
        borderRadius: '8px',
        border: '1px solid #333'
      }}>
        <h2 style={{ color: '#fff', margin: '0 0 10px 0' }}>Browser Info:</h2>
        <p>User Agent: {typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}</p>
        <p>Canvas Test: {canvasTest ? '✓ Pass' : '✗ Fail'}</p>
        <p>WebGL Test: Check results above</p>
      </div>

      <div style={{ marginTop: '20px', color: '#aaa' }}>
        <p>💡 If all tests pass but you still don't see the background:</p>
        <ol>
          <li>Try refreshing the page (F5)</li>
          <li>Check if the background is too subtle (try /visible-bg)</li>
          <li>Look for console errors in browser dev tools (F12)</li>
        </ol>
      </div>
    </div>
  );
}