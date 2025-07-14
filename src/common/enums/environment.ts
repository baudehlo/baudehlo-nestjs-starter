export enum Environment {
  development = 'development',
  production = 'production',
  test = 'test',
}

export const isProduction = process.env.NODE_ENV === Environment.production;
