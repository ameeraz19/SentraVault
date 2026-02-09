module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Note: react-native-reanimated/plugin removed because we use native Animated API
  };
};
