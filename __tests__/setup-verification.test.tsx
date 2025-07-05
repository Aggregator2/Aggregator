// Test to verify Jest setup is working correctly
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Simple component for testing
const TestComponent: React.FC<{ message: string }> = ({ message }) => {
  return <div data-testid="test-component">{message}</div>;
};

describe('Jest Setup Verification', () => {
  // Test basic JavaScript/TypeScript functionality
  test('basic math operations work', () => {
    expect(1 + 1).toBe(2);
    expect(true).toBeTruthy();
    expect(false).toBeFalsy();
  });

  // Test TypeScript types
  test('TypeScript types work correctly', () => {
    const value: string = 'hello';
    const num: number = 42;
    const bool: boolean = true;
    
    expect(typeof value).toBe('string');
    expect(typeof num).toBe('number');
    expect(typeof bool).toBe('boolean');
  });

  // Test React component rendering
  test('React components render correctly', () => {
    render(<TestComponent message="Hello Jest!" />);
    
    const element = screen.getByTestId('test-component');
    expect(element).toBeInTheDocument();
    expect(element).toHaveTextContent('Hello Jest!');
  });

  // Test async operations
  test('async operations work', async () => {
    const asyncFunction = async (): Promise<string> => {
      return new Promise((resolve) => {
        setTimeout(() => resolve('async result'), 100);
      });
    };

    const result = await asyncFunction();
    expect(result).toBe('async result');
  });

  // Test mock functions
  test('mock functions work correctly', () => {
    const mockFn = jest.fn();
    mockFn('arg1', 'arg2');
    
    expect(mockFn).toHaveBeenCalled();
    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  // Test environment variables
  test('environment variables are set', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000');
  });

  // Test module mocking
  test('CSS modules are mocked correctly', () => {
    // This would normally import a CSS module
    const styles = require('../__mocks__/styleMock.js');
    expect(styles).toEqual({});
  });

  // Test global mocks
  test('global mocks are working', () => {
    expect(global.ResizeObserver).toBeDefined();
    expect(global.IntersectionObserver).toBeDefined();
    expect(window.matchMedia).toBeDefined();
  });
});

// Test for API endpoint mocking
describe('API Testing Setup', () => {
  test('can test Next.js API routes', async () => {
    // Mock Next.js request and response
    const mockReq = {
      method: 'GET',
      headers: {},
      query: { id: '123' },
    };

    const mockRes = {
      status: jest.fn(() => mockRes),
      json: jest.fn(() => mockRes),
    };

    // Example API handler
    const handler = async (req: any, res: any) => {
      res.status(200).json({ success: true, id: req.query.id });
    };

    await handler(mockReq, mockRes);

    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.json).toHaveBeenCalledWith({ success: true, id: '123' });
  });
});