// Jest's supported extension point lets us use current jsdom without overriding
// the older version pinned by jest-environment-jsdom.
import BaseJSDOMEnvironment from '@jest/environment-jsdom-abstract'
import * as jsdom from 'jsdom'

export default class JSDOMEnvironment extends BaseJSDOMEnvironment {
  constructor(config, context) {
    super(config, context, jsdom)
  }
}
