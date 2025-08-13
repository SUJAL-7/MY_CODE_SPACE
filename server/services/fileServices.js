const fs = require("fs");

const writeToFile = (location, code) => {

  console.log(code);

  fs.writeFile(location, code, (err) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log("Data written to file");
  });
};

module.exports = { writeToFile };
