'use strict';

var vec3 = require('gl-matrix').vec3;
var quat = require('gl-matrix').quat;
var mat4 = require('gl-matrix').mat4;

var nanoECS = require('nano-ecs');

var Mtrl = require('./mtrl.js');
var Mover = require('./mover.js');
var BodyModel = require('./body-model.js');

function SolidModel() {
  this.entities = null;

  this.models = null;
  this.materials = null;

  // Transparency defaults. Overridden by ball skins, primarily.

  this.transparentDepthTest = true;
  this.transparentDepthMask = false;
}

/*
 * Entity components.
 */
function Drawable() {
  this.model = null;
}

function ModelMatrix() {
  // Override 'new'.
  return mat4.create();
}

function Spatial() {
  this.position = vec3.create()
  this.orientation = quat.create();
  this.scale = vec3.fromValues(1, 1, 1);
}

Spatial.prototype.getTransform = function (M) {
  var p = this.position;
  var e = this.orientation;
  var s = this.scale;

  mat4.fromRotationTranslationScale(M, e, p, s);
}

function Movers() {
  this.translate = null;
  this.rotate = null;
}

function Item() {
  this.value = 0;
}

function Billboard() {
  this.mtrl = null;

  this.t = 1.0;

  this.w = vec3.create();
  this.h = vec3.create();

  this.rx = vec3.create();
  this.ry = vec3.create();
  this.rz = vec3.create();

  this.flags = 0;
}

Billboard.prototype.fromSolBill = function (sol, solBill) {
  this.mtrl = sol.mv[solBill.mi];

  this.t = solBill.t;

  vec3.copy(this.w, solBill.w);
  vec3.copy(this.h, solBill.h);

  vec3.copy(this.rx, solBill.rx);
  vec3.copy(this.ry, solBill.ry);
  vec3.copy(this.rz, solBill.rz);

  this.flags = solBill.fl;
}

Billboard.prototype.getForegroundTransform = function(M, globalTime) {
  // sol_bill

  var T = this.t * globalTime;
  var S = Math.sin(T);

  var w = this.w[0] + this.w[1] * T + this.w[2] * S;
  var h = this.h[0] + this.h[1] * T + this.h[2] * S;

  var rx = this.rx[0] + this.rx[1] * T + this.rx[2] * S;
  var ry = this.ry[0] + this.ry[1] * T + this.ry[2] * S;
  var rz = this.rz[0] + this.rz[1] * T + this.rz[2] * S;

  // Preserve passed transform.
  //mat4.identity(M);

  // TODO multiply by view basis.
  // or... can be done by the caller.

  if (rx) mat4.rotateX(M, M, rx / 180.0 * Math.PI);
  if (ry) mat4.rotateY(M, M, ry / 180.0 * Math.PI);
  if (rz) mat4.rotateZ(M, M, rz / 180.0 * Math.PI);

  mat4.scale(M, M, [w, h, 0.0]);

  return M;
}

/*
 * Load entities from SOL.
 */
SolidModel.fromSol = function(sol) {
  var solidModel = new SolidModel();

  var ents = solidModel.entities = nanoECS();
  var models = solidModel.models = [];
  var materials = solidModel.materials = [];

  // Materials

  for (var i = 0; i < sol.mv.length; ++i) {
    var mtrl = new Mtrl(sol.mv[i]);
    materials.push(mtrl);
    sol.mv[i]._cachedMaterial = mtrl; // TODO FIXME
  }

  // Bodies

  for (var i = 0; i < sol.bv.length; ++i) {
    var solBody = sol.bv[i];
    var ent = ents.createEntity().addTag('body');

    ent.addComponent(Drawable);
    ent.addComponent(ModelMatrix);
    ent.addComponent(Spatial);
    ent.addComponent(Movers);

    var model = BodyModel.fromSolBody(sol, solBody);
    ent.drawable.model = model;
    models.push(model);

    // TODO should movers be entities?
    var movers = Mover.fromSolBody(sol, solBody);
    ent.movers.translate = movers.translate;
    ent.movers.rotate = movers.rotate;
  }

  // Items

  // Neverball item type to string.
  var itemTags = [null, 'coin', 'grow', 'shrink'];

  for (var i = 0; i < sol.hv.length; ++i) {
    var solItem = sol.hv[i];

    // Skip items we don't know about.
    if (!itemTags[solItem.t])
      continue;

    var ent = ents.createEntity().addTag('item').addTag(itemTags[solItem.t]);

    ent.addComponent(Item);
    ent.addComponent(Spatial);
    ent.addComponent(ModelMatrix);

    ent.item.value = solItem.n;

    // GLMatrix doesn't have a mat4.fromTranslationScale.

    const r = 0.15; // Neverball default.
    const x = solItem.p[0];
    const y = solItem.p[1];
    const z = solItem.p[2];

    vec3.set(ent.spatial.scale, r, r, r);

    vec3.set(ent.spatial.position, x, y, z);

    mat4.set(ent.modelMatrix,
      r, 0, 0, 0, // column 0
      0, r, 0, 0, // column 1
      0, 0, r, 0, // column 2
      x, y, z, 1  // column 3
    );
  }

  // Balls

  for (var i = 0; i < sol.uv.length; ++i) {
    var solBall = sol.uv[i];
    var ent = ents.createEntity().addTag('ball');

    ent.addComponent(Spatial);
    ent.addComponent(ModelMatrix);

    const r = solBall.r;
    const x = solBall.p[0];
    const y = solBall.p[1];
    const z = solBall.p[2];

    ent.spatial.scale = r;

    vec3.set(ent.spatial.position, x, y, z);

    mat4.set(ent.modelMatrix,
      r, 0, 0, 0, // column 0
      0, r, 0, 0, // column 1
      0, 0, r, 0, // column 2
      x, y, z, 1  // column 3
    );
  }

  // Billboards

  for (var i = 0; i < sol.rv.length; ++i) {
    var solBill = sol.rv[i];
    var ent = ents.createEntity().addTag('billboard');

    ent.addComponent(ModelMatrix);
    ent.addComponent(Spatial);
    ent.addComponent(Billboard);

    vec3.copy(ent.spatial.position, solBill.p);
    ent.spatial.getTransform(ent.modelMatrix);
    ent.billboard.fromSolBill(sol, solBill);
  }

  return solidModel;
}

SolidModel.prototype.step = function(dt) {
  var ents = this.entities.queryComponents([Spatial, ModelMatrix, Movers]);

  for (var i = 0; i < ents.length; ++i) {
    var ent = ents[i];

    // Update movers.

    var moverTranslate = ent.movers.translate;
    var moverRotate = ent.movers.rotate;

    if (moverTranslate === moverRotate) {
      moverTranslate.step(dt);
    } else {
      moverTranslate.step(dt);
      moverRotate.step(dt);
    }

    var p = ent.spatial.position;
    var e = ent.spatial.orientation;

    // Update model matrix.

    // TODO do this only on actual update
    moverTranslate.getPosition(p);
    moverRotate.getOrientation(e);

    mat4.fromRotationTranslation(ent.modelMatrix, e, p);
  }
}

/*
 * Create body mesh VBOs and textures.
 */
SolidModel.prototype.createObjects = function(gl) {
  var models = this.models;
  var materials = this.materials;

  for (var i = 0; i < models.length; ++i) {
    var model = models[i];
    if (model) {
      model.createObjects(gl);
    }
  }

  for (var i = 0; i < materials.length; ++i) {
    var mtrl = materials[i];
    mtrl.loadTexture(gl);
  }
}

/*
 * Render entity meshes of the given type. Pass a parentMatrix for hierarchical transform.
 */
SolidModel.prototype.drawMeshType = function(gl, state, meshType, parentMatrix) {
  var ents = this.entities.queryComponents([Drawable, ModelMatrix]);

  for (var i = 0; i < ents.length; ++i) {
    var ent = ents[i];
    var model = ent.drawable.model;

    if (parentMatrix) {
      // TODO move this off the render path.
      var modelMatrix = mat4.create();
      mat4.multiply(modelMatrix, parentMatrix, ent.modelMatrix);
      // TODO update uniforms on actual change
      gl.uniformMatrix4fv(state.uModelID, false, modelMatrix);
    } else {
      gl.uniformMatrix4fv(state.uModelID, false, ent.modelMatrix);
    }

    // TODO tag entities w/ models that have this mesh type?
    // Iterate over tagged lists?
    model.drawMeshType(gl, state, meshType);
  }
}

/*
 * Render model meshes. Pass a parentMatrix for hierarchical transform.
 */
SolidModel.prototype.drawBodies = function(gl, state, parentMatrix) {
  // sol_draw()

  const mask = this.transparentDepthMask;
  const test = this.transparentDepthTest;

  // TODO mirrors
  this.drawMeshType(gl, state, 'reflective', parentMatrix);

  this.drawMeshType(gl, state, 'opaque', parentMatrix);
  this.drawMeshType(gl, state, 'opaqueDecal', parentMatrix);

  if (!test) gl.disable(gl.DEPTH_TEST);
  if (!mask) gl.depthMask(false);
  {
    this.drawMeshType(gl, state, 'transparentDecal', parentMatrix);
    this.drawMeshType(gl, state, 'transparent', parentMatrix);
  }
  if (!mask) gl.depthMask(true);
  if (!test) gl.enable(gl.DEPTH_TEST);
}

// Synonym.
SolidModel.prototype.draw = SolidModel.prototype.drawBodies;

/*
 * Render item entities with a pre-loaded model.
 */
SolidModel.prototype.drawItems = function(gl, state) {
  var ents = this.entities.queryComponents([Item, ModelMatrix]);

  for (var i = 0; i < ents.length; ++i) {
    var ent = ents[i];

    // Pass entity transform as a parent matrix for nested SolidModel rendering.
    if (ent.hasTag('grow')) {
      state.growModel.draw(gl, state, ent.modelMatrix);
    } else if (ent.hasTag('shrink')) {
      state.shrinkModel.draw(gl, state, ent.modelMatrix);
    } else {
      if (ent.item.value >= 10) {
        state.coin10Model.draw(gl, state, ent.modelMatrix);
      } else if (ent.item.value >= 5) {
        state.coin5Model.draw(gl, state, ent.modelMatrix);
      } else {
        state.coinModel.draw(gl, state, ent.modelMatrix);
      }
    }
  }
}

/*
 * Render ball entities with a pre-loaded model.
 */
SolidModel.prototype.drawBalls = function(gl, state) {
  var ents = this.entities.queryTag('ball');

  for (var i = 0; i < ents.length; ++i) {
    var ent = ents[i];

    state.ballModel.draw(gl, state, ent.modelMatrix);
  }
}

SolidModel.prototype.drawBills = function(gl, state, parentMatrix) {
  var ents = this.entities.queryComponents([Billboard, Spatial, ModelMatrix]);

  // TODO
  var viewBasis = state.view.getBasis();
  var modelMatrix = mat4.create();

  state.billboardMesh.enableDraw(gl, state);

  const test = this.transparentDepthTest;
  const mask = this.transparentDepthMask;

  if (!test) gl.disable(gl.DEPTH_TEST);
  if (!mask) gl.depthMask(false);

  for (var i = 0; i < ents.length; ++i) {
    var ent = ents[i];

    // TODO lots of math for a draw frame
    ent.spatial.getTransform(modelMatrix);
    // if (!B_NOFACE)
    mat4.multiply(modelMatrix, modelMatrix, viewBasis);
    ent.billboard.getForegroundTransform(modelMatrix, state.time);

    if (parentMatrix) {
      mat4.multiply(modelMatrix, parentMatrix, modelMatrix);
    }
    gl.uniformMatrix4fv(state.uModelID, false, modelMatrix);

    ent.billboard.mtrl._cachedMaterial.draw(gl, state);
    state.billboardMesh.draw(gl, state);
  }

  if (!mask) gl.depthMask(true);
  if (!test) gl.enable(gl.DEPTH_TEST);

  state.billboardMesh.disableDraw(gl, state);
}

module.exports = SolidModel;