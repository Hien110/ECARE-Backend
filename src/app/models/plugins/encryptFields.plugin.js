const { encryptGCM, decryptGCM, hmacIndex } = require('../../../utils/cryptoFields');

function encryptFieldsPlugin(schema, options) {
  const fields = options?.fields || [];
  const uniqueByHmac = options?.uniqueByHmac || [];

  for (const f of fields) {
    const encField = `${f}Enc`;
    const hashField = `${f}Hash`;

    const add = {};
    add[encField]  = { type: String, select: false, default: null };
    add[hashField] = { type: String, index: uniqueByHmac.includes(f) ? { unique: true, sparse: true } : false, select: false, default: null };
    schema.add(add);

    schema.virtual(f)
      .get(function () {
        const enc = this.get(encField);
        return enc ? decryptGCM(enc) : null;
      })
      .set(function (val) {
        if (val == null) {
          this.set(encField, null);
          // Không set hashField khi val là null để tránh duplicate key error
          this.unset(hashField);
        } else {
          this.set(encField, encryptGCM(val));
          this.set(hashField, hmacIndex(val));
        }
      });
  }
}

module.exports = encryptFieldsPlugin;