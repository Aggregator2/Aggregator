module.exports = (path, options) => {
  // Call the defaultResolver, so we leverage its cache, error handling, etc.
  return options.defaultResolver(path, {
    ...options,
    // Use packageFilter to process parsed `package.json` before the resolution
    packageFilter: pkg => {
      // Fix packages that have incorrect main/exports fields
      if (pkg.name === "uuid" || pkg.name === "nanoid") {
        delete pkg.exports;
        delete pkg.module;
      }
      return pkg;
    },
  });
};
