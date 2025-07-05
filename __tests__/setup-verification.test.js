// Test to verify Jest setup works with JavaScript files

describe('Jest Setup Verification (JavaScript)', () => {
  // Test basic JavaScript functionality
  test('basic JavaScript operations work', () => {
    expect(1 + 1).toBe(2);
    expect('hello' + ' world').toBe('hello world');
    expect([1, 2, 3]).toHaveLength(3);
  });

  // Test object operations
  test('object operations work correctly', () => {
    const obj = { name: 'test', value: 42 };
    expect(obj).toHaveProperty('name', 'test');
    expect(obj).toHaveProperty('value', 42);
  });

  // Test array operations
  test('array operations work correctly', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(arr.filter(x => x > 3)).toEqual([4, 5]);
    expect(arr.map(x => x * 2)).toEqual([2, 4, 6, 8, 10]);
  });

  // Test promises
  test('promises work correctly', async () => {
    const promise = Promise.resolve('resolved value');
    await expect(promise).resolves.toBe('resolved value');
  });

  // Test error handling
  test('error handling works', () => {
    const throwError = () => {
      throw new Error('Test error');
    };
    
    expect(throwError).toThrow('Test error');
  });

  // Test module imports
  test('can import modules', () => {
    const path = require('path');
    expect(path.join('a', 'b')).toBe('a/b'.replace('/', path.sep));
  });
});