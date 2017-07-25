'use strict';

var data = require('./data.js');

var mtrlImages = require('./mtrl-images.json');

var Mtrl = function () {
  this.d = new Float32Array([0.8, 0.8, 0.8, 1.0]);
  this.a = new Float32Array([0.2, 0.2, 0.2, 1.0]);
  this.s = new Float32Array([0, 0, 0, 1]);
  this.e = new Float32Array([0, 0, 0, 1]);
  this.h = new Float32Array([0]);
  this.fl = 0;
  this.f = '';

  this.alpha_func = 0;
  this.alpha_ref = 0.0;

  this.tex = null;
};

/*
 * Material type flags.
 */
Mtrl.PARTICLE = (1 << 10);
Mtrl.ALPHA_TEST = (1 << 9);
Mtrl.REFLECTIVE = (1 << 8);
Mtrl.TRANSPARENT = (1 << 7);
Mtrl.SHADOWED = (1 << 6);
Mtrl.DECAL = (1 << 5);
Mtrl.ENVIRONMENT = (1 << 4);
Mtrl.TWO_SIDED = (1 << 3);
Mtrl.ADDITIVE = (1 << 2);
Mtrl.CLAMP_S = (1 << 1);
Mtrl.CLAMP_T = (1 << 0);

Mtrl.prototype.toString = function () {
  return this.f;
};

/*
 * Material sorting rules.
 */
Mtrl.opaqueRules = { in: 0, ex: Mtrl.REFLECTIVE | Mtrl.TRANSPARENT | Mtrl.DECAL };
Mtrl.opaqueDecalRules = { in: Mtrl.DECAL, ex: Mtrl.REFLECTIVE | Mtrl.TRANSPARENT };
Mtrl.transparentDecalRules = { in: Mtrl.DECAL | Mtrl.TRANSPARENT, ex: Mtrl.REFLECTIVE };
Mtrl.transparentRules = { in: Mtrl.TRANSPARENT, ex: Mtrl.REFLECTIVE | Mtrl.DECAL };
Mtrl.reflectiveRules = { in: Mtrl.REFLECTIVE, ex: 0 };

Mtrl.prototype.test = function(rules) {
  return ((this.fl & rules.in) === rules.in && (this.fl & rules.ex) === 0);
}

Mtrl.prototype.isOpaque = function() {
  return this.test(Mtrl.opaqueRules);
}

Mtrl.prototype.isOpaqueDecal = function() {
  return this.test(Mtrl.opaqueDecalRules);
}

Mtrl.prototype.isTransparentDecal = function() {
  return this.test(Mtrl.transparentDecalRules);
}

Mtrl.prototype.isTransparent = function() {
  return this.test(Mtrl.transparentRules);
}

Mtrl.prototype.isReflective = function() {
  return this.test(Mtrl.reflectiveRules);
}

/*
 * Create a GL texture from the given image.
 */
Mtrl.prototype.createTexture = function (gl, img) {
  var tex = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, tex);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,
      this.fl & Mtrl.CLAMP_S ? gl.CLAMP_TO_EDGE : gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
      this.fl & Mtrl.CLAMP_T ? gl.CLAMP_TO_EDGE : gl.REPEAT);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  this.tex = tex;
};

/*
 * Apply material state.
 */
Mtrl.prototype.draw = function (gl, state) {
  // TODO shadow state locally?

  if (state.enableTextures && this.tex) {
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
  } else {
    gl.bindTexture(gl.TEXTURE_2D, state.defaultTexture);
  }

  gl.uniform4fv(state.uDiffuse, this.d);
  gl.uniform4fv(state.uAmbient, this.a);
  gl.uniform4fv(state.uSpecular, this.s);
  gl.uniform4fv(state.uEmissive, this.e);
  gl.uniform1f(state.uShininess, this.h[0]);

  if (this.fl & Mtrl.ENVIRONMENT) {
    gl.uniform1i(state.uEnvironment, 1);
  } else {
    gl.uniform1i(state.uEnvironment, 0);
  }

  if (this.fl & Mtrl.ADDITIVE) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    //gl.uniform1f(state.uAdditivity, 1.0);
  } else {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    //gl.uniform1f(state.uAdditivity, 0.0);
  }

  if (this.fl & Mtrl.TWO_SIDED) {
    gl.disable(gl.CULL_FACE);
  } else {
    gl.enable(gl.CULL_FACE);
  }

  if (this.fl & Mtrl.DECAL) {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1.0, -2.0);
  } else {
    gl.polygonOffset(0.0, 0.0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
};

/*
 * Download material image and create a texture.
 */
Mtrl.prototype.loadTexture = function (gl) {
  if (this._loading) {
    return;
  }
  if (this.tex) {
    console.log('Material ' + this + ' has already been loaded');
    return;
  }
  if (!mtrlImages[this]) {
    console.log('Material ' + this + ' is unknown');
    return;
  }

  // Prevent multiple loads. This is probably dumb.
  this._loading = true;
  var self = this;
  data.fetchImage(mtrlImages[self.f]).then(function(image) {
    self.createTexture(gl, image);
    delete self._loading;
  });
};

/*
 * Exports.
 */
module.exports = Mtrl;