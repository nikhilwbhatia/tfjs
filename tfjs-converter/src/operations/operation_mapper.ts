/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {DataType, ENV} from '@tensorflow/tfjs-core';

import * as tensorflow from '../data/compiled_api';
import {getRegisteredOp} from './custom_op/register';

import {getNodeNameAndIndex} from './executors/utils';
import * as arithmetic from './op_list/arithmetic';
import * as basicMath from './op_list/basic_math';
import * as control from './op_list/control';
import * as convolution from './op_list/convolution';
import * as creation from './op_list/creation';
import * as dynamic from './op_list/dynamic';
import * as evaluation from './op_list/evaluation';
import * as graph from './op_list/graph';
import * as image from './op_list/image';
import * as logical from './op_list/logical';
import * as matrices from './op_list/matrices';
import * as normalization from './op_list/normalization';
import * as reduction from './op_list/reduction';
import * as sliceJoin from './op_list/slice_join';
import * as spectral from './op_list/spectral';
import * as transformation from './op_list/transformation';
import {Graph, InputParamValue, Node, OpMapper, ParamValue} from './types';

export class OperationMapper {
  private static _instance: OperationMapper;

  private opMappers: {[key: string]: OpMapper};

  // Singleton instance for the mapper
  public static get Instance() {
    return this._instance || (this._instance = new this());
  }

  // Loads the op mapping from the JSON file.
  private constructor() {
    const ops = [
      arithmetic, basicMath, control, convolution, creation, dynamic,
      evaluation, logical, image, graph, matrices, normalization, reduction,
      sliceJoin, spectral, transformation
    ];
    const mappersJson: OpMapper[] = [].concat.apply([], ops.map(op => op.json));

    this.opMappers = mappersJson.reduce<{[key: string]: OpMapper}>(
        (map, mapper: OpMapper) => {
          map[mapper.tfOpName] = mapper;
          return map;
        },
        {});
  }

  // Converts the model from Tensorflow GraphDef to local representation for
  // TensorFlow.js API
  transformGraph(graph: tensorflow.IGraphDef): Graph {
    const tfNodes = graph.node;
    const placeholders: Node[] = [];
    const weights: Node[] = [];
    const nodes = tfNodes.reduce<{[key: string]: Node}>((map, node) => {
      map[node.name] = this.mapNode(node);
      if (node.op === 'Placeholder') {
        placeholders.push(map[node.name]);
      }
      if (node.op === 'Const') {
        weights.push(map[node.name]);
      }
      return map;
    }, {});

    const inputs: Node[] = [];
    const outputs: Node[] = [];
    const allNodes = Object.keys(nodes);
    allNodes.forEach(key => {
      const node = nodes[key];
      node.inputNames.forEach(name => {
        const [nodeName, ] = getNodeNameAndIndex(name);
        node.inputs.push(nodes[nodeName]);
        nodes[nodeName].children.push(node);
      });
      if (node.inputs.length === 0) {
        inputs.push(node);
      }
    });

    allNodes.forEach(key => {
      const node = nodes[key];
      if (node.children.length === 0) {
        outputs.push(node);
      }
    });

    return {nodes, inputs, outputs, weights, placeholders};
  }

  private mapNode(node: tensorflow.INodeDef): Node {
    // Unsupported ops will cause an error at run-time (not parse time), since
    // they may not be used by the actual execution subgraph.
    const mapper =
        getRegisteredOp(node.op) || this.opMappers[node.op] || {} as OpMapper;
    if (node.attr == null) {
      node.attr = {};
    }

    const newNode: Node = {
      name: node.name,
      op: node.op,
      category: mapper.category,
      inputNames:
          (node.input ||
           []).map(input => input.startsWith('^') ? input.substr(1) : input),
      inputs: [],
      children: [],
      inputParams: {},
      attrParams: {},
      rawAttrs: node.attr
    };

    if (mapper.inputs != null) {
      newNode.inputParams =
          mapper.inputs.reduce<{[key: string]: InputParamValue}>(
              (map, param) => {
                map[param.name] = {
                  type: param.type,
                  inputIndexStart: param.start,
                  inputIndexEnd: param.end
                };
                return map;
              },
              {});
    }
    if (mapper.attrs != null) {
      newNode.attrParams =
          mapper.attrs.reduce<{[key: string]: ParamValue}>((map, param) => {
            const type = param.type;
            let value = undefined;
            switch (param.type) {
              case 'string':
                value = getStringParam(
                    node.attr, param.tfName, param.defaultValue as string);

                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getStringParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as string);
                }
                break;
              case 'string[]':
                value = getStringArrayParam(
                    node.attr, param.tfName, param.defaultValue as string[]);

                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getStringArrayParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as string[]);
                }
                break;
              case 'number':
                value = getNumberParam(
                    node.attr, param.tfName,
                    (param.defaultValue || 0) as number);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getNumberParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as number);
                }
                break;
              case 'number[]':
                value = getNumericArrayParam(
                    node.attr, param.tfName, param.defaultValue as number[]);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getNumericArrayParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as number[]);
                }
                break;
              case 'bool':
                value = getBoolParam(
                    node.attr, param.tfName, param.defaultValue as boolean);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getBoolParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as boolean);
                }
                break;
              case 'bool[]':
                value = getBoolArrayParam(
                    node.attr, param.tfName, param.defaultValue as boolean[]);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getBoolArrayParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as boolean[]);
                }
                break;
              case 'shape':
                value = getTensorShapeParam(
                    node.attr, param.tfName, param.defaultValue as number[]);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getTensorShapeParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as number[]);
                }
                break;
              case 'shape[]':
                value = getTensorShapeArrayParam(
                    node.attr, param.tfName, param.defaultValue as number[][]);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getTensorShapeArrayParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as number[][]);
                }
                break;
              case 'dtype':
                value = getDtypeParam(
                    node.attr, param.tfName, param.defaultValue as DataType);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getDtypeParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as DataType);
                }
                break;
              case 'dtype[]':
                value = getDtypeArrayParam(
                    node.attr, param.tfName, param.defaultValue as DataType[]);
                if (value === undefined && !!param.tfDeprecatedName) {
                  value = getDtypeArrayParam(
                      node.attr, param.tfDeprecatedName,
                      param.defaultValue as DataType[]);
                }
                break;
              case 'tensor':
              case 'tensors':
                break;
              default:
                throw new Error(
                    `Unsupported param type: ${param.type} for op: ${node.op}`);
            }
            map[param.name] = {value, type};
            return map;
          }, {});
    }
    return newNode;
  }
}

export function decodeBase64(text: string): string {
  const global = ENV.global;
  if (typeof global.atob !== 'undefined') {
    return global.atob(text);
  } else if (typeof Buffer !== 'undefined') {
    return new Buffer(text, 'base64').toString();
  } else {
    throw new Error(
        'Unable to decode base64 in this environment. ' +
        'Missing built-in atob() or Buffer()');
  }
}

export function parseStringParam(s: []|string, keepCase: boolean): string {
  const value =
      Array.isArray(s) ? String.fromCharCode.apply(null, s) : decodeBase64(s);
  return keepCase ? value : value.toLowerCase();
}

export function getStringParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string, def: string,
    keepCase = false): string {
  const param = attrs[name];
  if (param != null) {
    return parseStringParam(param.s, keepCase);
  }
  return def;
}

export function getBoolParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: boolean): boolean {
  const param = attrs[name];
  return param ? param.b : def;
}

export function getNumberParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: number): number {
  const param = attrs[name] || {};
  const value =
      param['i'] != null ? param['i'] : (param['f'] != null ? param['f'] : def);
  return (typeof value === 'number') ? value : parseInt(value, 10);
}

export function parseDtypeParam(value: string|tensorflow.DataType): DataType {
  if (typeof (value) === 'string') {
    // tslint:disable-next-line:no-any
    value = tensorflow.DataType[value as any];
  }
  switch (value) {
    case tensorflow.DataType.DT_FLOAT:
      return 'float32';
    case tensorflow.DataType.DT_INT32:
    case tensorflow.DataType.DT_INT64:
      return 'int32';
    case tensorflow.DataType.DT_BOOL:
      return 'bool';
    case tensorflow.DataType.DT_DOUBLE:
      return 'float32';
    case tensorflow.DataType.DT_STRING:
      return 'string';
    default:
      // Unknown dtype error will happen at runtime (instead of parse time),
      // since these nodes might not be used by the actual subgraph execution.
      return null;
  }
}

export function getDtypeParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: DataType): DataType {
  const param = attrs[name];
  if (param && param.type) {
    return parseDtypeParam(param.type);
  }
  return def;
}

export function getDtypeArrayParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: DataType[]): DataType[] {
  const param = attrs[name];
  if (param && param.list && param.list.type) {
    return param.list.type.map(v => parseDtypeParam(v));
  }
  return def;
}

export function parseTensorShapeParam(shape: tensorflow.ITensorShape): number[]|
    undefined {
  if (shape.unknownRank) {
    return undefined;
  }
  if (shape.dim != null) {
    return shape.dim.map(
        dim =>
            (typeof dim.size === 'number') ? dim.size : parseInt(dim.size, 10));
  }
  return [];
}

export function getTensorShapeParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def?: number[]): number[]|undefined {
  const param = attrs[name];
  if (param && param.shape) {
    return parseTensorShapeParam(param.shape);
  }
  return def;
}

export function getNumericArrayParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: number[]): number[] {
  const param = attrs[name];
  if (param) {
    return ((param.list.f && param.list.f.length ? param.list.f :
                                                   param.list.i) ||
            [])
        .map(v => (typeof v === 'number') ? v : parseInt(v, 10));
  }
  return def;
}

export function getStringArrayParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string, def: string[],
    keepCase = false): string[] {
  const param = attrs[name];
  if (param && param.list && param.list.s) {
    return param.list.s.map((v) => {
      return parseStringParam(v, keepCase);
    });
  }
  return def;
}

export function getTensorShapeArrayParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: number[][]): number[][] {
  const param = attrs[name];
  if (param && param.list && param.list.shape) {
    return param.list.shape.map((v) => {
      return parseTensorShapeParam(v);
    });
  }
  return def;
}

export function getBoolArrayParam(
    attrs: {[key: string]: tensorflow.IAttrValue}, name: string,
    def: boolean[]): boolean[] {
  const param = attrs[name];
  if (param && param.list && param.list.b) {
    return param.list.b;
  }
  return def;
}
