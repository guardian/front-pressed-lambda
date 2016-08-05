import babel from 'rollup-plugin-babel';
import json from 'rollup-plugin-json';
import nodeResolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';

export default {
	entry: 'lambda/index.js',
	plugins: [
		json(),
		babel(),
		nodeResolve({
			jsnext: true
		}),
		commonjs()
	],
	format: 'cjs',
	dest: 'tmp/lambda/index.js',
	external: ['aws-sdk']
};
