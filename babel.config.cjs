module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: 'current',
        },
        modules: 'commonjs', // CommonJS形式に変換
      },
    ],
    '@babel/preset-typescript',
  ],
};