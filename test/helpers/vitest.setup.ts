import 'reflect-metadata';

// Global test setup for Vitest
// Raise the listener limit to accommodate multiple test-instantiated filters/services
process.setMaxListeners(50);
