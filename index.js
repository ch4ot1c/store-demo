'use strict';

var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var bitcore = require('bitcore-lib');
var bodyParser = require('body-parser');
const mongoose = require('mongoose');

const Merchant = require('./models').Merchant;
const Invoice = require('./models').Invoice;
const Product = require('./models').Product;

// Connect to MongoDB
const DUMMY_MONGO_URL = 'mongodb://localhost:27017/store-demo';
mongoose.connect(DUMMY_MONGO_URL);

function LemonadeStand(options) {
  EventEmitter.call(this);

  this.node = options.node;
  this.log = this.node.log;

  this.invoiceHtml = fs.readFileSync(__dirname + '/invoice.html', 'utf8');

  // (generate_hd_wallet.js needs to occur by this time)

  Merchant.findOne({})
  .select('xpub addressIndex')
  .exec()
  .then(m => {
    this.xpub = m.xpub;
  })
  .catch(e => {
    console.error(e);
    return res.status(500).send({error: 'Failed to find Merchant in Mongo'});
  });

  //TODO Implement State Machine: AWAITING_PAYMENT -> FULL_AMOUNT_RECEIVED / TIMED_OUT / PARTIAL_AMOUNT_RECEIVED
  //TODO reuse code from invoice.html (client)

  var socket = io('http://localhost:8001');
  socket.emit('subscribe', 'bitcoind/addresstxid', ['{{address}}']);
  socket.on('bitcoind/addresstxid', function(data) {
   var address = bitcore.Address(data.address);
   console.log(address);
     //TODO save an entry in db for each confirmed payment, for each relevant addr
     //db.save({index: index, txid: txid, fromAddress, amount, time})
  }

}

LemonadeStand.dependencies = ['bitcoind'];

LemonadeStand.prototype.start = function(callback) {
  setImmediate(callback);
};

LemonadeStand.prototype.stop = function(callback) {
  setImmediate(callback);
};

LemonadeStand.prototype.getAPIMethods = function() {
  return [];
};

LemonadeStand.prototype.getPublishEvents = function() {
  return [];
};


LemonadeStand.prototype.setupRoutes = function(app, express) {
  var self = this;

  app.use(bodyParser.urlencoded({extended: true}));

  app.use('/', express.static(__dirname + '/static'));

  // This module will be installed as a service of Bitcore, which will be running on 8001.

  // *** Invoice Server model ***
  // To generate an invoice,
  // POST localhost:8001/invoice {productID: String}
  // (Starts at addressIndex `1`)
  // TODO Rate limit per ip
  // TODO deliveryEmail (optional)

  // TODO represent as state machine on both client and srv - AWAITING_PAYMENT -> FULL_AMOUNT_RECEIVED / TIMED_OUT / PARTIAL_AMOUNT_RECEIVED

  app.post('/invoice', function(req, res, next) {
    let productID = req.body.productID;
    var addressIndex;

    // Generate (next) fresh address & present invoice
    Merchant.findOneAndUpdate({}, {$inc: {addressIndex: 1}})
    .exec()
    .then(m => {
      addressIndex = m.addressIndex;
      return Product.findById(productID).exec();
    })
    .then(p => {
      return Invoice.create({addressIndex: addressIndex, productID: p.productID, amount: p.price}).exec();
    })
    .then(i => {
      // Content-Type: text/html
      return res.status(200).send(self.buildInvoiceHTML(srv.addressIndex));
    })
    .catch(e => {
      console.error(e);
      return res.status(500).send({error: 'Failed to find Merchant/create Invoice in Mongo'});
    });
  });

};

LemonadeStand.prototype.getRoutePrefix = function() {
  return 'store-demo';
};

// Reason for new xpub each time - 1) no cost 2) if they make a tx mistake (when invoiced), they can do followup payments without much additional accounting logic
LemonadeStand.prototype.buildInvoiceHTML = function(addressIndex) {
  let price = 12340000; // (sats)
  let btcpPrice = price / 1e8;

  // Address for this invoice
  let address = this.xpub.deriveChild("/0/" + addressIndex).privateKey.toAddress();

  this.log.info('New invoice, with generated address:', address);

  var hash = address.hashBuffer.toString('hex');
  var transformed = this.invoiceHtml
    .replace(/{{price}}/g, btcpPrice)
    .replace(/{{address}}/g, address)
    .replace(/{{hash}}/g, hash)
    .replace(/{{baseUrl}}/g, '/' + this.getRoutePrefix() + '/');
  return transformed;
};

module.exports = LemonadeStand;