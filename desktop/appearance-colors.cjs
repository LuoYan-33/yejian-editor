/** 根据背景色的相对亮度选择对比度更高的文字和控件配色。 */
function backgroundScheme(background) {
  const [red, green, blue] = background.slice(1).match(/../g).map(hex => {
    const channel = Number.parseInt(hex, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.179 ? 'dark' : 'light';
}

module.exports = { backgroundScheme };
