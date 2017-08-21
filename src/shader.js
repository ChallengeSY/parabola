'use strict';

var ShaderGraph = require('@parasti/shadergraph')(fetchSnippet);
var Mtrl = require('./mtrl.js');
var Uniform = require('./uniform.js');

/*
 * Build shaders and uniforms for the given material.
 */
var Shader = module.exports = function (mtrl) {
  var shaderFlags = shaderFlagsFromMtrl(mtrl);

  var material = ShaderGraph.material();

  var frag = material.fragment;
  var vert = material.vertex;

  // Each snippet instance can have their own uniforms. That's what this is for.

  var uniforms = {
    mainTexture: { Texture: Uniform('i') },
    transform: {
      ModelViewMatrix: Uniform('mat4'),
      ProjMatrix: Uniform('mat4'),
      NormalMatrix: Uniform('mat3')
    },
    alphaTest: { AlphaRef: Uniform('f') }
  };

  /*
   * Build a fragment shader.
   */

  if (shaderFlags & Shader.LIT) {
    frag
      .fan()
        .pipe('frag.getTexCoord')
        .pipe('sampleTexture', uniforms.texture)
      .next()
        .pipe('frag.getLightColor')
      .end()
      .pipe('multiply');
  } else {
    frag
      .pipe('frag.getTexCoord')
      .pipe('sampleTexture', uniforms.texture);
  }

  if (shaderFlags & Shader.ALPHA_TEST) {
    var alphaFunc = alphaFuncSnippets[alphaFuncFromShaderFlags(shaderFlags)];

    if (alphaFunc) {
      frag
        .require(alphaFunc)
        .pipe('frag.alphaTest', uniforms.alphaTest);
    }
  }

  frag.pipe('frag.setFragColor');

  /*
   * Build a vertex shader.
   */

  // First, build the texcoord subgraph.

  var texCoordGraph = ShaderGraph.shader();

  if (shaderFlags & Shader.ENVIRONMENT) {
    texCoordGraph
      .pipe('vert.getNormal')
      .pipe('viewNormal', uniforms.transform)
      .pipe('genSphereMapCoords') // 1 leftover input serves as subgraph input
      .pipe('vert.setTexCoord');
  } else {
    texCoordGraph
      .pipe('vert.getTexCoord')
      .pipe('vert.setTexCoord')
  }

  // Then, build the main graph.

  vert
    .pipe('vert.getPosition')
    .pipe('viewVertex', uniforms.transform)
    .fan()
      .pipe('projVertex', uniforms.transform)
      .pipe('vert.setPosition')
    .next()
      .pipe(texCoordGraph)
    .end();

  var program = material.link();

  return {
    shaderFlags: shaderFlags,
    vertexShader: program.vertexShader,
    fragmentShader: program.fragmentShader,
    uniforms: uniforms,
    mangledUniforms: program.uniforms
  }
}

Shader.uploadUniforms = function (gl, shader) {
  var program = shader.program;

  if (program) {
    var uniforms = shader.mangledUniforms;

    for (var name in uniforms) {
      // TODO cache this
      var location = gl.getUniformLocation(program, name);
      var uniform = uniforms[name];

      Uniform.upload(gl, location, uniform);
    }
  }
}

/*
 * Gather shader flags from a SOL material.
 */
function shaderFlagsFromMtrl (mtrl) {
  var flags = 0;

  if (mtrl.fl & Mtrl.LIT) {
    flags |= Shader.LIT;
  }

  if (mtrl.fl & Mtrl.ALPHA_TEST) {
    flags |= shaderFlagsFromAlphaFunc(mtrl.alphaFunc);
  }

  if (mtrl.fl & Mtrl.ENVIRONMENT) {
    flags |= Shader.ENVIRONMENT;
  }

  return flags;
}

/*
 * Features that a shader implements. Together these form the signature of a shader.
 */

Shader.LIT           = (1 << 0);
Shader.ENVIRONMENT   = (1 << 1);
Shader.ALPHA_TEST    = (7 << 2); // 3 bits = space for a number in range [1, 7]

var alphaFuncFromShaderFlags = (flags) => (flags >> 2) & 0x7;
var shaderFlagsFromAlphaFunc = (index) => (index & 0x7) << 2;

// Alpha function snippets by index (indices from share/solid_base.c)
var alphaFuncSnippets = [
  undefined, // 0 = always = no alpha test
  'testEqual',
  'testGequal',
  'testGreater',
  'testLequal',
  'testLess',
  'testNever',
  'testNotEqual',
];

/*
 * Snippet library.
 */

function fetchSnippet (key) {
  if (/^vert\./.test(key)) {
    return vertSnippets[key.slice(5)];
  } else if (/^frag\./.test(key)) {
    return fragSnippets[key.slice(5)];
  } else {
    return glslSnippets[key];
  }
}

var fragSnippets = {
  getTexCoord: `
  varying vec2 vTexCoord;
  vec2 getTexCoord() { return vTexCoord; }`,
  
  getLightColor: `
  varying vec4 vLightColor;
  vec4 getLightColor() { return vLightColor; }`,

  alphaTest: `
  uniform float AlphaRef;

  bool alphaFunc(float alpha, float ref);
  vec4 alphaTest(vec4 color) {
    if (!alphaFunc(color.a, ref))
      discard;
    return color;
  }`,
  
  setFragColor: `
  void setFragColor(vec4 color) { gl_FragColor = color; }`,
};

var vertSnippets = {
  getPosition: `
  attribute vec3 aPosition;
  vec4 getPosition() { return vec4(aPosition, 1.0); }`,

  getNormal: `
  attribute vec3 aNormal;
  vec3 getNormal() { return aNormal; }`,
  
  getTexCoord: `
  attribute vec2 aTexCoord;
  vec2 getTexCoord() { return aTexCoord; }`,

  setPosition: `
  void setPosition(vec4 v) { gl_Position = v; }
  `,
  
  setTexCoord: `
  varying vec2 vTexCoord;
  void setTexCoord(vec2 uv) { vTexCoord = uv; }`,
  
  setLightColor: `
  varying vec4 vLightColor;
  void setLightColor(vec4 color) { vLightColor = color; }`,
};

var glslSnippets = {
  multiply: binaryOp('a * b', 'vec4'),

  sampleTexture: `
  uniform sampler2D Texture;
  vec4 sampleTexture(vec2 uv) { return texture2D(Texture, uv); }`,

  genSphereMapCoords: `
  vec2 genSphereMapCoords(vec3 u, vec3 n) {
    vec3 r = u - 2.0 * n * (n * u);
    r.z += 1.0;
    float m = 2.0 * length(r);
    return vec2(r.x / m + 0.5, r.y / m + 0.5);
  }
  vec2 genSphereMapCoords(vec4 u, vec3 n) {
    return genSphereMapCoords(vec3(u), n);
  }`,

  viewVertex: `
  uniform mat4 ModelViewMatrix;
  vec4 viewVertex(vec4 v) { return ModelViewMatrix * v; }`,

  viewNormal: `
  uniform mat3 NormalMatrix;
  vec3 viewNormal(vec3 n) { return NormalMatrix * n; }`,

  projVertex: `
  uniform mat4 ProjMatrix;
  vec4 projVertex(vec4 v) { return ProjMatrix * v; }`,

  testEqual:    binaryOp('a == b', 'float', 'bool'),
  testGequal:   binaryOp('a >= b', 'float', 'bool'),
  testGreater:  binaryOp('a > b',  'float', 'bool'),
  testLequal:   binaryOp('a <= b', 'float', 'bool'),
  testLess:     binaryOp('a < b',  'float', 'bool'),
  testNever:    binaryOp('false',  'float', 'bool'),
  testNotEqual: binaryOp('a != b', 'float', 'bool'),
};

/*
 * Make a snippet for a binary operation. MathBox-inspired.
 */
function binaryOp (expr, valType, retType) {
  retType = retType || valType;
  return `${retType} binaryOp(${valType} a, ${valType} b) { return ${expr}; }`;
}