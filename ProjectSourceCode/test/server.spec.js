// ********************** Initialize server **********************************

const server = require('../index'); //TODO: Make sure the path to your index.js is correctly added

// ********************** Import Libraries ***********************************

const chai = require('chai'); // Chai HTTP provides an interface for live integration testing of the API's.
const chaiHttp = require('chai-http');
chai.should();
chai.use(chaiHttp);
const {assert, expect} = chai;

// ********************** DEFAULT WELCOME TESTCASE ****************************

describe('Server!', () => {
  // Sample test case given to test / endpoint.
  it('Returns the default welcome message', done => {
    chai
      .request(server)
      .get('/welcome')
      .end((err, res) => {
        expect(res).to.have.status(200);
        expect(res.body.status).to.equals('success');
        assert.strictEqual(res.body.message, 'Welcome!');
        done();
      });
  });
});

// *********************** TODO: WRITE 2 UNIT TESTCASES **************************
describe('Testing Add User API', () => {
    it('positive : /register', done => {
      chai
        .request(server)
        .post('/register?test=true')
        .send({username: 'bob', password: 'test123', confirmpassword: 'test123'})
        .end((err, res) => {
          expect(res).to.have.status(200);
          expect(res.body.message).to.equals('Success');
          done();
        });
    });
  });

describe('Testing Add User API', () => {
it('negative : /register', done => {
    chai
    .request(server)
    .post('/register?test=true')
    .send({username: 'bobtest', password: 23, confirmpassword: 23})
    .end((err, res) => {
        expect(res).to.have.status(400);
        expect(res.body.message).to.equals('Invalid Input');
        done();
    });
});
});

// ********************************************************************************