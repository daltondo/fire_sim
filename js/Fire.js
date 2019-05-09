/**
 * @author Mike Piecuch / https://github.com/mikepiecuch
 * @addons Julian Cervantes/Dalton Do/Ayush Maganahalli
 *
 * Based on research paper "Real-Time Fluid Dynamics for Games" by Jos Stam
 * http://www.dgp.toronto.edu/people/stam/reality/Research/pdf/GDC03.pdf
 *
 */
THREE.Fire = function ( geometry, options ) {
	THREE.Mesh.call( this, geometry );
	this.type = 'Fire';
	this.clock = new THREE.Clock();
	options = options || {};

	var textureWidth = options.textureWidth || 512;
	var textureHeight = options.textureHeight || 512;
	var oneOverWidth = 1.0 / textureWidth;
	var oneOverHeight = 1.0 / textureHeight;

	// Setting the default parameters
	var debug = ( options.debug === undefined ) ? false : options.debug;
	this.color1 = options.color1 || new THREE.Color( 0xffffff );
	this.color2 = options.color2 || new THREE.Color( 0xffa000 );
	this.color3 = options.color3 || new THREE.Color( 0x000000 );
	this.colorBias = ( options.colorBias === undefined ) ? 0.8 : options.colorBias;
	this.diffuse = ( options.diffuse === undefined ) ? 1.33 : options.diffuse;
	this.viscosity = ( options.viscosity === undefined ) ? 0.25 : options.viscosity;
	this.expansion = ( options.expansion === undefined ) ? - 0.25 : options.expansion;
	this.swirl = ( options.swirl === undefined ) ? 50.0 : options.swirl;
	this.burnRate = ( options.burnRate === undefined ) ? 0.3 : options.burnRate;
	this.drag = ( options.drag === undefined ) ? 0.35 : options.drag;
	this.airSpeed = ( options.airSpeed === undefined ) ? 6.0 : options.airSpeed;
	this.windVector = options.windVector || new THREE.Vector2( 0.0, 0.75 );
	this.speed = ( options.speed === undefined ) ? 500.0 : options.speed;
	this.massConservation = ( options.massConservation === undefined ) ? false : options.massConservation;

	var size = textureWidth * textureHeight;
	// Computational grid that moves around the fluid
	this.sourceData = new Uint8Array( 4 * size );


	/*
	* Deletes fire sources
	*/
	this.clearSources = function () {
		for ( var y = 0; y < textureHeight; y ++ ) {
			for ( var x = 0; x < textureWidth; x ++ ) {
				var i = y * textureWidth + x;
				var stride = i * 4;

				this.sourceData[ stride ] = 0;
				this.sourceData[ stride + 1 ] = 0;
				this.sourceData[ stride + 2 ] = 0;
				this.sourceData[ stride + 3 ] = 0;
			}
		}

		this.sourceMaterial.uniforms[ "sourceMap" ].value = this.internalSource;
		this.sourceMaterial.needsUpdate = true;

		return this.sourceData;
	};


	/*
	* Adds fire sources
	*/
	this.addSource = function ( u, v, radius, density = null, windX = null, windY = null ) {
		var startX = Math.max( Math.floor( ( u - radius ) * textureWidth ), 0 );
		var startY = Math.max( Math.floor( ( v - radius ) * textureHeight ), 0 );
		var endX = Math.min( Math.floor( ( u + radius ) * textureWidth ), textureWidth );
		var endY = Math.min( Math.floor( ( v + radius ) * textureHeight ), textureHeight );

		for ( var y = startY; y < endY; y ++ ) {
			for ( var x = startX; x < endX; x ++ ) {
				var diffX = x * oneOverWidth - u;
				var diffY = y * oneOverHeight - v;

				if ( diffX * diffX + diffY * diffY < radius * radius ) {
					var i = y * textureWidth + x;
					var stride = i * 4;

					if ( density != null ) {
						this.sourceData[ stride ] = Math.min( Math.max( density, 0.0 ), 1.0 ) * 255;
					}

					if ( windX != null ) {
						var wind = Math.min( Math.max( windX, - 1.0 ), 1.0 );
						wind = ( wind < 0.0 ) ? Math.floor( wind * 127 ) + 255 : Math.floor( wind * 127 );
						this.sourceData[ stride + 1 ] = wind;
					}

					if ( windY != null ) {

						var wind = Math.min( Math.max( windY, - 1.0 ), 1.0 );
						wind = ( wind < 0.0 ) ? Math.floor( wind * 127 ) + 255 : Math.floor( wind * 127 );
						this.sourceData[ stride + 2 ] = wind;
					}
				}
			}
		}

		this.internalSource.needsUpdate = true;
		return this.sourceData;
	};


	// When setting source map, red channel is density. Green and blue channels
	// encode x and y velocity respectively as signed chars:
	// (0 -> 127 = 0.0 -> 1.0, 128 -> 255 = -1.0 -> 0.0 )
	this.setSourceMap = function ( texture ) {
		this.sourceMaterial.uniforms[ "sourceMap" ].value = texture;
	};


	var parameters = {
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter,
		depthBuffer: false,
		stencilBuffer: false
	};


	// a buffer where the video card draws pixels for a scene that	is being rendered in the background
	this.field0 = new THREE.WebGLRenderTarget( textureWidth, textureHeight, parameters );
	this.field0.background = new THREE.Color( 0x000000 );

	this.field1 = new THREE.WebGLRenderTarget( textureWidth, textureHeight, parameters );
	this.field0.background = new THREE.Color( 0x000000 );

	this.fieldProj = new THREE.WebGLRenderTarget( textureWidth, textureHeight, parameters );
	this.field0.background = new THREE.Color( 0x000000 );

	// check if we can generate mipmaps (only if both the width and height are powers of 2)
	if (!THREE.Math.isPowerOfTwo(textureWidth) ||
		 ! THREE.Math.isPowerOfTwo(textureHeight)) {

		this.field0.texture.generateMipmaps = false;
		this.field1.texture.generateMipmaps = false;
		this.fieldProj.texture.generateMipmaps = false;
	}


	this.fieldScene = new THREE.Scene();
	this.fieldScene.background = new THREE.Color( 0x000000 );

	// camera that uses orthographic projection
	this.orthoCamera = new THREE.OrthographicCamera( textureWidth / - 2, textureWidth / 2, textureHeight / 2, textureHeight / - 2, 1, 2 );
	this.orthoCamera.position.z = 1;

	this.fieldGeometry = new THREE.PlaneBufferGeometry( textureWidth, textureHeight );
	this.internalSource = new THREE.DataTexture( this.sourceData, textureWidth, textureHeight, THREE.RGBAFormat );


	/* 
	* SOURCE SHADER
	*/
	// puts the Source Shader into 'shader'
	var shader = THREE.Fire.SourceShader;
	this.sourceMaterial = new THREE.ShaderMaterial( {
		uniforms: shader.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		transparent: false
	} );

	this.clearSources();
	// adds the source mesh into the scene
	this.sourceMesh = new THREE.Mesh( this.fieldGeometry, this.sourceMaterial );
	this.fieldScene.add( this.sourceMesh );


	/* 
	* DIFFUSE SHADER 
	*/
	// puts the Diffuse Shader into 'shader'
	var shader = THREE.Fire.DiffuseShader;
	this.diffuseMaterial = new THREE.ShaderMaterial( {
		uniforms: shader.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		transparent: false
	} );

	this.diffuseMaterial.uniforms[ "oneOverWidth" ].value = oneOverWidth;
	this.diffuseMaterial.uniforms[ "oneOverHeight" ].value = oneOverHeight;
	// adds the diffuse mesh into the scene
	this.diffuseMesh = new THREE.Mesh( this.fieldGeometry, this.diffuseMaterial );
	this.fieldScene.add( this.diffuseMesh );


	/* 
	* DRIFT SHADER 
	*/
	// puts the Drift Shader into 'shader'
	shader = THREE.Fire.DriftShader;
	this.driftMaterial = new THREE.ShaderMaterial( {
		uniforms: shader.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		transparent: false
	} );

	this.driftMaterial.uniforms[ "oneOverWidth" ].value = oneOverWidth;
	this.driftMaterial.uniforms[ "oneOverHeight" ].value = oneOverHeight;
	// adds the drift mesh into the scene
	this.driftMesh = new THREE.Mesh( this.fieldGeometry, this.driftMaterial );
	this.fieldScene.add( this.driftMesh );


	/* 
	* COLOR SHADER 
	*/
	if (debug) {
		shader = THREE.Fire.DebugShader;
	} else {

		shader = THREE.Fire.ColorShader;

	}
	// puts the Shader Material into 'material' using the Color Shader
	this.material = new THREE.ShaderMaterial( {
		uniforms: shader.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		transparent: true
	} );

	this.material.uniforms[ "densityMap" ].value = this.field1.texture;

	/*
	* TEST SHADER
	*/
	/* TODO: 1. Instantiate the test shader here */
	shader = THREE.Fire.TestShader;
	this.testMaterial = new THREE.ShaderMaterial( {
		uniforms: shader.uniforms,
		vertexShader: shader.vertexShader,
		fragmentShader: shader.fragmentShader,
		transparent: false
	} );

	this.testMaterial.uniforms[ "oneOverWidth" ].value = oneOverWidth;
	this.testMaterial.uniforms[ "oneOverHeight" ].value = oneOverHeight;
	// adds the test mesh into the scene
	this.testMesh = new THREE.Mesh( this.fieldGeometry, this.testMaterial );
	this.fieldScene.add( this.testMesh );

	// sets the uniforms for all the shaders
	// key = uniform name
	// value = uniform value
	// ex. uniform diffuse = dt * 0.05 * this.diffuse;;
	this.configShaders = function ( dt ) {
		this.diffuseMaterial.uniforms[ "diffuse" ].value = dt * 0.05 * this.diffuse;
		this.diffuseMaterial.uniforms[ "viscosity" ].value = dt * 0.05 * this.viscosity;
		this.diffuseMaterial.uniforms[ "expansion" ].value = Math.exp( this.expansion * - 1.0 );
		this.diffuseMaterial.uniforms[ "swirl" ].value = Math.exp( this.swirl * - 0.1 );
		this.diffuseMaterial.uniforms[ "drag" ].value = Math.exp( this.drag * - 0.1 );
		this.diffuseMaterial.uniforms[ "burnRate" ].value = this.burnRate * dt * 0.01;
		this.driftMaterial.uniforms[ "windVector" ].value = this.windVector;
		this.driftMaterial.uniforms[ "airSpeed" ].value = dt * this.airSpeed * 0.001 * textureHeight;
		this.material.uniforms[ "color1" ].value = this.color1;
		this.material.uniforms[ "color2" ].value = this.color2;
		this.material.uniforms[ "color3" ].value = this.color3;
		this.material.uniforms[ "colorBias" ].value = this.colorBias;

		this.testMaterial.uniforms[ "windVector" ].value = this.windVector;
		this.testMaterial.uniforms[ "airSpeed" ].value = dt * this.airSpeed * 0.001 * textureHeight;
	};

	/*
	* Sets the uniforms for diffuse
	*/
	this.clearDiffuse = function () {
		this.diffuseMaterial.uniforms[ "expansion" ].value = 1.0;
		this.diffuseMaterial.uniforms[ "swirl" ].value = 1.0;
		this.diffuseMaterial.uniforms[ "drag" ].value = 1.0;
		this.diffuseMaterial.uniforms[ "burnRate" ].value = 0.0;
	};


	this.swapTextures = function () {
		var swap = this.field0;
		this.field0 = this.field1;
		this.field1 = swap;
	};


	this.saveRenderState = function ( renderer ) {
		this.savedRenderTarget = renderer.getRenderTarget();
		this.savedVrEnabled = renderer.vr.enabled;
		this.savedShadowAutoUpdate = renderer.shadowMap.autoUpdate;
		this.savedAntialias = renderer.antialias;
		this.savedToneMapping = renderer.toneMapping;
	};
	this.restoreRenderState = function ( renderer ) {
		renderer.vr.enabled = this.savedVrEnabled;
		renderer.shadowMap.autoUpdate = this.savedShadowAutoUpdate;
		renderer.setRenderTarget( this.savedRenderTarget );
		renderer.antialias = this.savedAntialias;
		renderer.toneMapping = this.savedToneMapping;
	};

	/*
	* Renders source shader
	*/
	this.renderSource = function ( renderer ) {
		this.sourceMesh.visible = true;

		this.sourceMaterial.uniforms[ "densityMap" ].value = this.field0.texture;

		renderer.setRenderTarget( this.field1 );
		renderer.render( this.fieldScene, this.orthoCamera );

		this.sourceMesh.visible = false;

		this.swapTextures();
	};
	/*
	* Renders diffuse shader
	*/
	this.renderDiffuse = function ( renderer ) {
		this.diffuseMesh.visible = true;

		this.diffuseMaterial.uniforms[ "densityMap" ].value = this.field0.texture;

		renderer.setRenderTarget( this.field1 );
		renderer.render( this.fieldScene, this.orthoCamera );

		this.diffuseMesh.visible = false;

		this.swapTextures();
	};
	/*
	* Renders drift shader
	*/
	this.renderDrift = function ( renderer ) {
		this.driftMesh.visible = true;

		this.driftMaterial.uniforms[ "densityMap" ].value = this.field0.texture;

		renderer.setRenderTarget( this.field1 );
		renderer.render( this.fieldScene, this.orthoCamera );

		this.driftMesh.visible = false;

		this.swapTextures();
	};
	/* TODO: 2. Render the test shader here */
	/*
	* Renders test shader
	*/
	this.renderTest = function ( renderer ) {
		this.testMesh.visible = true;

		this.testMaterial.uniforms[ "densityMap" ].value = this.field0.texture;

		renderer.setRenderTarget( this.field1 );
		renderer.render( this.fieldScene, this.orthoCamera );

		this.testMesh.visible = false;

		this.swapTextures();
	};

	/*
	* Handles drawing all the shaders
	*/
	this.onBeforeRender = function ( renderer ) {
		var delta = this.clock.getDelta();
		if ( delta > 0.1 ) {
			delta = 0.1;
		}

		var dt = delta * ( this.speed * 0.1 );
		this.configShaders( dt );
		this.saveRenderState( renderer );

		renderer.vr.enabled = false; // Avoid camera modification and recursion
		renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows
		renderer.antialias = false;
		renderer.toneMapping = THREE.NoToneMapping;

		this.sourceMesh.visible = false;
		this.diffuseMesh.visible = false;
		this.driftMesh.visible = false;
		/* TODO: 3. Add the test mesh here */
		this.testMesh.visible = false;

		// Renders the initial density source
		this.renderSource( renderer );

		this.clearDiffuse();
		// Layers on diffuse shaders - diffusion through each cell
		for ( var i = 0; i < 5; i ++ ) {
			this.renderDiffuse( renderer );
		}
		this.configShaders( dt );
		// Handles outwards movement of flame
		this.renderDiffuse( renderer );

		// Handles movement of flame upwards
		this.renderDrift( renderer );

		/* TODO: 4. Render the test shader */
		// this.renderTest( renderer );

		// Final result out for coloring
		this.material.map = this.field1.texture;
		this.material.transparent = true;
		this.material.minFilter = THREE.LinearFilter,
		this.material.magFilter = THREE.LinearFilter,

		this.restoreRenderState( renderer );
	};
};


THREE.Fire.prototype = Object.create(THREE.Mesh.prototype);
THREE.Fire.prototype.constructor = THREE.Fire;


/*
* GLSL Source Shader
*/
THREE.Fire.SourceShader = {
	uniforms: {
		'sourceMap': {
			type: 't',
			value: null
		},
		'densityMap': {
			type: 't',
			value: null
		}
	},

	vertexShader: [
		'varying vec2 vUv;',

		'void main() {',

		' 	  vUv = uv;',

		'     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
		'     gl_Position = projectionMatrix * mvPosition;',

		'}'
	].join( "\n" ),

	fragmentShader: [
		'uniform sampler2D sourceMap;',
		'uniform sampler2D densityMap;',

		'varying vec2 vUv;',

		'void main() {',
		'    vec4 source = texture2D( sourceMap, vUv );',
		'    vec4 current = texture2D( densityMap, vUv );',

		'    vec2 v0 = (current.gb - step(0.5, current.gb)) * 2.0;',
		'    vec2 v1 = (source.gb - step(0.5, source.gb)) * 2.0;',

		'    vec2 newVel = v0 + v1;',

		'    newVel = clamp(newVel, -0.99, 0.99);',
		'    newVel = newVel * 0.5 + step(0.0, -newVel);',

		'    float newDensity = source.r + current.a;',
		'    float newTemp = source.r + current.r;',

		'    newDensity = clamp(newDensity, 0.0, 1.0);',
		'    newTemp = clamp(newTemp, 0.0, 1.0);',

		'    gl_FragColor = vec4(newTemp, newVel.xy, newDensity);',

		'}'
	].join( "\n" )
};


/* 
* GLSL Diffuse Shader 
*/
THREE.Fire.DiffuseShader = {
	uniforms: {
		'oneOverWidth': {
			type: 'f',
			value: null
		},
		'oneOverHeight': {
			type: 'f',
			value: null
		},
		'diffuse': {
			type: 'f',
			value: null
		},
		'viscosity': {
			type: 'f',
			value: null
		},
		'expansion': {
			type: 'f',
			value: null
		},
		'swirl': {
			type: 'f',
			value: null
		},
		'drag': {
			type: 'f',
			value: null
		},
		'burnRate': {
			type: 'f',
			value: null
		},
		'densityMap': {
			type: 't',
			value: null
		}
	},

	vertexShader: [
		'varying vec2 vUv;',

		'void main() {',

		' 	  vUv = uv;',

		'     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
		'     gl_Position = projectionMatrix * mvPosition;',

		'}'
	].join( "\n" ),

	fragmentShader: [
		'uniform float oneOverWidth;',
		'uniform float oneOverHeight;',
		'uniform float diffuse;',
		'uniform float viscosity;',
		'uniform float expansion;',
		'uniform float swirl;',
		'uniform float burnRate;',
		'uniform float drag;',
		'uniform sampler2D densityMap;',

		'varying vec2 vUv;',

		'void main() {',

		'    vec4 dC = texture2D( densityMap, vUv );',
		'    vec4 dL = texture2D( densityMap, vec2(vUv.x - oneOverWidth, vUv.y) );',
		'    vec4 dR = texture2D( densityMap, vec2(vUv.x + oneOverWidth, vUv.y) );',
		'    vec4 dU = texture2D( densityMap, vec2(vUv.x, vUv.y - oneOverHeight) );',
		'    vec4 dD = texture2D( densityMap, vec2(vUv.x, vUv.y + oneOverHeight) );',
		'    vec4 dUL = texture2D( densityMap, vec2(vUv.x - oneOverWidth, vUv.y - oneOverHeight) );',
		'    vec4 dUR = texture2D( densityMap, vec2(vUv.x + oneOverWidth, vUv.y - oneOverHeight) );',
		'    vec4 dDL = texture2D( densityMap, vec2(vUv.x - oneOverWidth, vUv.y + oneOverHeight) );',
		'    vec4 dDR = texture2D( densityMap, vec2(vUv.x + oneOverWidth, vUv.y + oneOverHeight) );',

		'    dC.yz = (dC.yz - step(0.5, dC.yz)) * 2.0;',
		'    dL.yz = (dL.yz - step(0.5, dL.yz)) * 2.0;',
		'    dR.yz = (dR.yz - step(0.5, dR.yz)) * 2.0;',
		'    dU.yz = (dU.yz - step(0.5, dU.yz)) * 2.0;',
		'    dD.yz = (dD.yz - step(0.5, dD.yz)) * 2.0;',
		'    dUL.yz = (dUL.yz - step(0.5, dUL.yz)) * 2.0;',
		'    dUR.yz = (dUR.yz - step(0.5, dUR.yz)) * 2.0;',
		'    dDL.yz = (dDL.yz - step(0.5, dDL.yz)) * 2.0;',
		'    dDR.yz = (dDR.yz - step(0.5, dDR.yz)) * 2.0;',

		'    vec4 result = (dC + vec4(diffuse, viscosity, viscosity, diffuse) * ( dL + dR + dU + dD + dUL + dUR + dDL + dDR )) / (1.0 + 8.0 * vec4(diffuse, viscosity, viscosity, diffuse)) - vec4(0.0, 0.0, 0.0, 0.001);',

		'    float temperature = result.r;',
		'    temperature = clamp(temperature - burnRate, 0.0, 1.0);',

		'    vec2 velocity = result.yz;',

		'    vec2 expansionVec = vec2(dL.w - dR.w, dU.w - dD.w);',

		'    vec2 swirlVec = vec2((dL.z - dR.z) * 0.5, (dU.y - dD.y) * 0.5);',

		'    velocity = velocity + (1.0 - expansion) * expansionVec + (1.0 - swirl) * swirlVec;',

		'    velocity = velocity - (1.0 - drag) * velocity;',

		'    gl_FragColor = vec4(temperature, velocity * 0.5 + step(0.0, -velocity), result.w);',

		'    gl_FragColor = gl_FragColor * step(oneOverWidth, vUv.x);',
		'    gl_FragColor = gl_FragColor * step(oneOverHeight, vUv.y);',
		'    gl_FragColor = gl_FragColor * step(vUv.x, 1.0 - oneOverWidth);',
		'    gl_FragColor = gl_FragColor * step(vUv.y, 1.0 - oneOverHeight);',

		'}'
	].join( "\n" )
};


/*
* GLSL Drift Shader
*/
THREE.Fire.DriftShader = {
	uniforms: {
		'oneOverWidth': {
			type: 'f',
			value: null
		},
		'oneOverHeight': {
			type: 'f',
			value: null
		},
		'windVector': {
			type: 'v2',
			value: new THREE.Vector2( 0.0, 0.0 )
		},
		'airSpeed': {
			type: 'f',
			value: null
		},
		'densityMap': {
			type: 't',
			value: null
		}
	},

	vertexShader: [
		'varying vec2 vUv;',

		'void main() {',

		' 	  vUv = uv;',

		'     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
		'     gl_Position = projectionMatrix * mvPosition;',

		'}'
	].join( "\n" ),

	fragmentShader: [
		'uniform float oneOverWidth;',
		'uniform float oneOverHeight;',
		'uniform vec2 windVector;',
		'uniform float airSpeed;',
		'uniform sampler2D densityMap;',

		'varying vec2 vUv;',

		'void main() {',
		'    vec2 velocity = texture2D( densityMap, vUv ).gb;',
		'    velocity = (velocity - step(0.5, velocity)) * 2.0;',

		'    velocity = velocity + windVector;',

		'    vec2 sourcePos = vUv - airSpeed * vec2(oneOverWidth, oneOverHeight) * velocity;',

		'    vec2 units = sourcePos / vec2(oneOverWidth, oneOverHeight);',

		'    vec2 intPos = floor(units);',
		'    vec2 frac = units - intPos;',
		'    intPos = intPos * vec2(oneOverWidth, oneOverHeight);',

		'    vec4 dX0Y0 = texture2D( densityMap, intPos + vec2(0.0, -oneOverHeight) );',
		'    vec4 dX1Y0 = texture2D( densityMap, intPos + vec2(oneOverWidth, 0.0) );',
		'    vec4 dX0Y1 = texture2D( densityMap, intPos + vec2(0.0, oneOverHeight) );',
		'    vec4 dX1Y1 = texture2D( densityMap, intPos + vec2(oneOverWidth, oneOverHeight) );',


		'    dX0Y0.gb = (dX0Y0.gb - step(0.5, dX0Y0.gb)) * 2.0;',
		'    dX1Y0.gb = (dX1Y0.gb - step(0.5, dX1Y0.gb)) * 2.0;',
		'    dX0Y1.gb = (dX0Y1.gb - step(0.5, dX0Y1.gb)) * 2.0;',
		'    dX1Y1.gb = (dX1Y1.gb - step(0.5, dX1Y1.gb)) * 2.0;',

		'    vec4 source = mix(mix(dX0Y0, dX1Y0, frac.x), mix(dX0Y1, dX1Y1, frac.x), frac.y);',

		'    source.gb = source.gb * 0.5 + step(0.0, -source.gb);',

		'    gl_FragColor = source;',

		'}'
	].join( "\n" )
};


/*
* GLSL Color Shader
*/
THREE.Fire.ColorShader = {
	uniforms: {
		'color1': {
			type: 'c',
			value: null
		},
		'color2': {
			type: 'c',
			value: null
		},
		'color3': {
			type: 'c',
			value: null
		},
		'colorBias': {
			type: 'f',
			value: null
		},
		'densityMap': {
			type: 't',
			value: null
		}
	},

	vertexShader: [
		'varying vec2 vUv;',

		'void main() {',

		' 	  vUv = uv;',

		'     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
		'     gl_Position = projectionMatrix * mvPosition;',

		'}'
	].join( "\n" ),

	fragmentShader: [
		'uniform vec3 color1;',
		'uniform vec3 color2;',
		'uniform vec3 color3;',
		'uniform float colorBias;',
		'uniform sampler2D densityMap;',

		'varying vec2 vUv;',

		'void main() {',
		'    float density = texture2D( densityMap, vUv ).a;',
		'    float temperature = texture2D( densityMap, vUv ).r;',

		'    float bias = clamp(colorBias, 0.0001, 0.9999);',

		'    vec3 blend1 = mix(color3, color2, temperature / bias) * (1.0 - step(bias, temperature));',
		'    vec3 blend2 = mix(color2, color1, (temperature - bias) / (1.0 - bias) ) * step(bias, temperature);',

		'    gl_FragColor = vec4(blend1 + blend2, density);',
		'}'
	].join( "\n" )
};


/*
* GLSL Debug Shader
*/
THREE.Fire.DebugShader = {
	uniforms: {
		'color1': {
			type: 'c',
			value: null
		},
		'color2': {
			type: 'c',
			value: null
		},
		'color3': {
			type: 'c',
			value: null
		},
		'colorBias': {
			type: 'f',
			value: null
		},
		'densityMap': {
			type: 't',
			value: null
		}
	},

	vertexShader: [
		'varying vec2 vUv;',

		'void main() {',

		' 	  vUv = uv;',

		'     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
		'     gl_Position = projectionMatrix * mvPosition;',

		'}'
	].join( "\n" ),

	fragmentShader: [
		'uniform sampler2D densityMap;',

		'varying vec2 vUv;',

		'void main() {',
		'    float density;',
		'    density = texture2D( densityMap, vUv ).a;',

		'    vec2 vel = texture2D( densityMap, vUv ).gb;',

		'    vel = (vel - step(0.5, vel)) * 2.0;',

		'    float r = density;',
		'    float g = max(abs(vel.x), density * 0.5);',
		'    float b = max(abs(vel.y), density * 0.5);',
		'    float a = max(density * 0.5, max(abs(vel.x), abs(vel.y)));',

		'    gl_FragColor = vec4(r, g, b, a);',

		'}'
	].join( "\n" )
};


/*
* GLSL Test Shader
*/
THREE.Fire.TestShader = {
	uniforms: {
		'oneOverWidth': {
			type: 'f',
			value: null
		},
		'oneOverHeight': {
			type: 'f',
			value: null
		},
		'windVector': {
			type: 'v2',
			value: new THREE.Vector2( 0.0, 0.0 )
		},
		'airSpeed': {
			type: 'f',
			value: null
		},
		'densityMap': {
			type: 't',
			value: null
		},

		// Add new uniforms here
		'colLight': {
			type: 'v3',
			value: new THREE.Vector3( 0.0, 0.0, 0.0 )
		},
		'colNormal': {
			type: 'v3',
			value: new THREE.Vector3( 0.0, 0.0, 0.0 )
		},
		'colDark': {
			type: 'v3',
			value: new THREE.Vector3( 0.0, 0.0, 0.0 )
		},
		'colLight': {
			type: 'f',
			value: 0
		},
	},

	vertexShader: [
		'varying vec2 vUv;',
		'varying float noise;',
		'uniform vec3 colLight;',
		'uniform vec3 colNormal;',
		'uniform vec3 colDark;',
		'uniform float opacity;',

		'vec3 blend( vec3 cola, vec3 colb, float percent ) {',
		'  return vec3(',
		'    cola.r + (colb.r - cola.r) * percent,',
		'    cola.g + (colb.g - cola.g) * percent,',
		'    cola.b + (colb.b - cola.b) * percent',
		'  );',
		'}',

		'void main() {',
		// ' 	  vUv = uv;',

		// '     vec3 col;',
		// '     float range = 1.0 * noise;',
		// '  	  if(range > .6) col = colDark;',
		// '  	  else if(range > .4) col = blend(colNormal, colDark, (range - .4) / .2);',
		// '  	  else col = blend(colLight, colNormal, range / .4);',

		// '  	  gl_FragColor = vec4( col, opacity );',

		/* Drift vertex shader */
		' 	  vUv = uv;',

		'     vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
		'     gl_Position = projectionMatrix * mvPosition;',
		'}'
	].join( "\n" ),

	fragmentShader: [
		'uniform float oneOverWidth;',
		'uniform float oneOverHeight;',
		'uniform vec2 windVector;',
		'uniform float airSpeed;',
		'uniform sampler2D densityMap;',

		'varying vec2 vUv;',

		'void main() {',
		'    vec2 velocity = texture2D( densityMap, vUv ).gb;',
		'    velocity = (velocity - step(0.5, velocity)) * 2.0;',

		'    velocity = velocity + windVector;',

		'    vec2 sourcePos = vUv - airSpeed * vec2(oneOverWidth, oneOverHeight) * velocity;',

		'    vec2 units = sourcePos / vec2(oneOverWidth, oneOverHeight);',

		'    vec2 intPos = floor(units);',
		'    vec2 frac = units - intPos;',
		'    intPos = intPos * vec2(oneOverWidth, oneOverHeight);',

		'    vec4 dX0Y0 = texture2D( densityMap, intPos + vec2(0.0, -oneOverHeight) );',
		'    vec4 dX1Y0 = texture2D( densityMap, intPos + vec2(oneOverWidth, 0.0) );',
		'    vec4 dX0Y1 = texture2D( densityMap, intPos + vec2(0.0, oneOverHeight) );',
		'    vec4 dX1Y1 = texture2D( densityMap, intPos + vec2(oneOverWidth, oneOverHeight) );',


		'    dX0Y0.gb = (dX0Y0.gb - step(0.5, dX0Y0.gb)) * 2.0;',
		'    dX1Y0.gb = (dX1Y0.gb - step(0.5, dX1Y0.gb)) * 2.0;',
		'    dX0Y1.gb = (dX0Y1.gb - step(0.5, dX0Y1.gb)) * 2.0;',
		'    dX1Y1.gb = (dX1Y1.gb - step(0.5, dX1Y1.gb)) * 2.0;',

		'    vec4 source = mix(mix(dX0Y0, dX1Y0, frac.x), mix(dX0Y1, dX1Y1, frac.x), frac.y);',

		'    source.gb = source.gb * 0.5 + step(0.0, -source.gb);',

		'    gl_FragColor = source;',

		'}'
	].join( "\n" )
};