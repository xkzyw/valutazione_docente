const crypto = require("crypto");

function createToken(len){
    return crypto.randomBytes(len).toString("hex");
}

module.exports = {createToken};