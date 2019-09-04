import {
  createStore,
  applyMiddleware
} from 'redux'
import thunk from 'redux-thunk'
import { createLogger } from 'redux-logger'
import React, { Component } from 'react'
import { Provider } from 'react-redux'
import combineAppReducers from './reduxUtils/combineAppReducers'
import createTridentNavigator from './navigation/WeNavigator'
import { generateRouteName } from './navigation/NavigationUtils'
import { createGlobalConnect } from './reduxUtils'
import connectModules from './reduxUtils/connectModules'
import { AppNavigator } from './navigation'
import _ from 'lodash'
import URLUtils from './utils/URLUtils'
import PropTypes from 'prop-types'
import { PopupStub } from '@unpourtous/react-native-popup-stub'
import TianYan, {Dashboard} from '@unpourtous/tianyan-react-native'

export default class TridentApp extends Component {
  static propTypes = {
    reduxConfig: PropTypes.object,
    navigationConfig: PropTypes.object
  }

  constructor () {
    super(...arguments)
    const middlewares = []

    const {reduxConfig, navigationConfig} = this.props
    middlewares.push(createLogger(reduxConfig || require('./reduxUtils/reduxConfig').default.logger))
    console.ignoredYellowBox = [
      'Task orphaned for request',
      'source.uri should not be an empty string'
    ]
    middlewares.push(thunk)
    const middleware = applyMiddleware(...middlewares)

    // 路由名称为`moduleName.sceneName`
    this.connectedContainer = createGlobalConnect(this.props.container)(this.props.container.component)
    const connectedModules = connectModules(this.props.modules, this.connectedContainer)

    const flatRouters = (() => {
      let result = {}
      const moduleNames = Object.keys(connectedModules.routers)
      for (let moduleName of moduleNames) {
        const sceneNames = Object.keys(connectedModules.routers[moduleName])
        for (let sceneName of sceneNames) {
          let routeName = generateRouteName(moduleName, sceneName)
          result[routeName] = connectedModules.routers[moduleName][sceneName]
        }
      }
      return result
    })()

    AppNavigator.init(flatRouters)

    this.WeNavigator = createTridentNavigator(flatRouters, navigationConfig)

    const store = createStore(
      combineAppReducers(
        undefined,
        this.connectedContainer,
        connectedModules,
        this.WeNavigator.MyStackNavigator,
        (state, nextState, action) => {
          // gets the current screen from navigation state
          const getCurrentRouteName = (navigationState) => {
            if (!navigationState) {
              return null
            }
            const findCurrentRoute = (navigationState) => {
              if (navigationState.index !== undefined) {
                return findCurrentRoute(navigationState.routes[navigationState.index])
              }
              return navigationState
            }
            return findCurrentRoute(navigationState)
          }

          const oldTopSceneState = getCurrentRouteName(state)
          const newTopSceneState = getCurrentRouteName(nextState)

          let fromRouteName, toRouteName, fromSceneKey, toSceneKey

          if (!oldTopSceneState || !oldTopSceneState.routeName) {
            fromRouteName = null
            fromSceneKey = null
          } else {
            fromRouteName = oldTopSceneState.routeName
            fromSceneKey = oldTopSceneState.key
          }
          toRouteName = newTopSceneState.routeName
          toSceneKey = newTopSceneState.key

          if ((AppNavigator.lastScene === undefined && AppNavigator.currentScene === undefined && fromSceneKey === null) ||
            (!!fromSceneKey && !!toSceneKey && fromSceneKey !== toSceneKey)) {
            // 从action里面拿数据，不要从state里面拿，state里面可能是用setParams修改过的
            let currentParams = _.get(action, 'params', {})
            if (action.type === 'Navigation/RESET') {
              currentParams = _.get(action.actions[0], 'params', {})
            }
            // 过滤参数
            const lastSceneURL = AppNavigator.currentSceneURL || 'null'
            const currentSceneURL = URLUtils.appendParams(toRouteName || 'null', currentParams)
            // Statistics.reportPageEnd(lastSceneURL)
            // Statistics.reportPageStart(currentSceneURL)

            if (fromSceneKey && fromSceneKey !== toSceneKey) {
              //* 如果有注册onPause，则调用
              if (_.isFunction(AppNavigator.lifecycleCallback.onPause[fromSceneKey])) {
                AppNavigator.lifecycleCallback.onPause[fromSceneKey] && AppNavigator.lifecycleCallback.onPause[fromSceneKey](fromRouteName, toRouteName)
              }
            }

            if (fromSceneKey && _.isFunction(AppNavigator.lifecycleCallback.onResume[toSceneKey])) {
              AppNavigator.lifecycleCallback.onResume[toSceneKey](fromRouteName, toRouteName)
            } else {
              AppNavigator.addPendingLifecycleCallback(toSceneKey, { fromScene: fromRouteName, toScene: toRouteName })
            }

            AppNavigator.lastScene = oldTopSceneState || {}
            AppNavigator.currentScene = newTopSceneState || {}

            AppNavigator.lastSceneURL = lastSceneURL
            AppNavigator.currentSceneURL = currentSceneURL
            // console.log('currentScene change')
          }
          const navTimeConsuming = {}
          if (AppNavigator.currentScene && AppNavigator.currentScene.routeName) {
            const routeName = AppNavigator.currentScene.routeName
            if (action.type === 'Navigation/NAVIGATE') {
              navTimeConsuming[routeName] = {
                startTime: new Date().getTime()
              }
            }
            if (action.type === 'Navigation/COMPLETE_TRANSITION' &&
              navTimeConsuming[routeName] &&
              navTimeConsuming[routeName].startTime) {
              const endTime = new Date().getTime()
              navTimeConsuming[routeName].endTime = endTime

              console.log(routeName + ' 切换耗时 ' + (endTime - navTimeConsuming[routeName].startTime))
              // Statistics.reportTimeConsuming(routeName, navTimeConsuming[routeName].startTime, endTime)
              delete navTimeConsuming[routeName]
            }
          }

        }
      ),
      undefined,
      middleware
    )

    this.store = store
  }

  render () {
    const Navigator = this.WeNavigator.stackNavigator
    return (
      <Provider store={this.store}>
        <this.connectedContainer initProps={{ ...this.props }}>
          <Navigator />
          <PopupStub maskColor='rgba(0,0,0,0.75)' ref={_ref => {
            if (_ref) PopupStub.init(_ref)
          }} />
          <TianYan
            options={{
              logServerUrl: 'http://10.107.104.145:3000/v1/log',
              maxLogLine: 1000,
              ignoreFilter: function () {
                const filterLog = true

                if (!filterLog) return false

                let filterRule = /%c prev state|%c next state|%c action|%c CHANGED|%c ADDED|productinfo\/getfinancepageviewinfoV3|productinfo\/getinvestpageviewinfoV3|productinfo\/getproductlistbycode|gold\/query_current_price/g

                // 过滤掉状态的打印, 避免刷屏
                return ((arguments && typeof arguments[0] === 'string' && arguments[0].match(filterRule)) ||
                  (typeof arguments[1] === 'string' && arguments[1].match(filterRule)))
                // 理财的实在太多了， 里面屏蔽一下
              }
            }} />
        </this.connectedContainer>
      </Provider>
    )
  }
}
