export default {
  parse: function(error) {
    const matchedError = error.match(/.+?(\))/);
    return matchedError ? matchedError[0] : error;
  }
};
