const bcrypt = require('bcrypt')
const fs = require('fs-extra')
const path = require('path')
const crypto = require('crypto')

class Lock {
  create (password) {
    return new Promise((resolve, reject) => {
      bcrypt.hash(password, 10).then((hash) => {
        resolve(hash)
      })
    })
  }

  hash (password) {
    return Buffer.alloc(32, crypto.createHmac('sha256', password).digest('binary'))
  }

  open (dir, password) {
    const indexFile = path.join(dir, `index.json`)
    const lockFile = path.join(dir, `.lock`)

    return this._verify(lockFile, indexFile)
               .then(() => {
                 var encryptedData = fs.readFileSync(lockFile, 'utf8')
                 var [ivHex, data, hash] = encryptedData.split('$')
                 var dataHash = crypto.createHmac('sha256', data).digest('hex')

                 if (dataHash !== hash) {
                   throw new Error('Corrupt data')
                 }

                 var iv = Buffer.from(ivHex, 'hex')
                 var key = this.hash(password)
                 const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)

                 try {
                   var decrypted = decipher.update(data, 'base64', 'utf8') + decipher.final('utf8')
                   decrypted = JSON.parse(decrypted, null, 2)

                   const verify = bcrypt.compare(password, decrypted.lock)

                   return verify.then((result) => {
                     delete decrypted._lock
                     decrypted = JSON.stringify(decrypted)

                     return fs.writeFile(indexFile, decrypted, 'utf8')
                     .then(fs.remove(lockFile))
                   })
                 } catch (e) {
                   throw new Error('Invalid password')
                 }
               })
  }

  close (dir, password) {
    const indexFile = path.join(dir, `index.json`)
    const lockFile = path.join(dir, `.lock`)

    return this._verify(lockFile, indexFile, true)
                .then(() => {
                  var data = fs.readFileSync(indexFile, 'utf8')
                  data = JSON.parse(data, null, 2)

                  const verify = bcrypt.compare(password, data.lock)
                  return verify.then((result) => {
                    if (!result) {
                      throw new Error('Invalid password')
                    }

                    var key = this.hash(password)
                    const iv = crypto.randomBytes(16)
                    const ivHex = iv.toString('hex')
                    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)

                    data = Object.assign({}, data, {_lock: { iv: ivHex }})
                    data = JSON.stringify(data)
                    data = cipher.update(data, 'utf8', 'base64') + cipher.final('base64')
                    var dataHash = crypto.createHmac('sha256', data).digest('hex')
                    data = `${ivHex}$${data}$${dataHash}`

                    return fs.writeFile(lockFile, data, 'utf8')
                               .then(fs.remove(indexFile))
                  })
                })
  }

  _verify (lockFile, indexFile, close) {
    return new Promise((resolve, reject) => {
      if (close && fs.existsSync(lockFile)) {
        reject(new Error('Already locked'))
        return
      }

      if (close && !fs.existsSync(indexFile)) {
        reject(new Error('Missing index'))
        return
      }

      if (!close && fs.existsSync(indexFile)) {
        reject(new Error('Already open'))
        return
      }

      if (!close && !fs.existsSync(lockFile)) {
        reject(new Error('Missing lock'))
        return
      }

      resolve()
    })
  }

}

module.exports = Lock
