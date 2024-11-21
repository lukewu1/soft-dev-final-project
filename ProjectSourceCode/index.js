// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************


const express = require("express"); // To build an application server or API
const app = express();
const handlebars = require("express-handlebars");
const Handlebars = require("handlebars");
const path = require("path");
const pgp = require("pg-promise")(); // To connect to the Postgres DB from the node server
const bodyParser = require("body-parser");
const session = require("express-session"); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require("bcryptjs"); //  To hash passwords
const axios = require("axios"); // To make HTTP requests from our server. We'll learn more about it in Part C.
const { profile } = require("console");



// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************


// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: "hbs",
  layoutsDir: __dirname + "/views/layouts",
  partialsDir: __dirname + "/views/partials",
});

//if block has no conditional, referenced hbs writeup to create custom helper for conditional logic ==
Handlebars.registerHelper('isequal', function (arg1, arg2) {
  return arg1 == arg2;
})

// database configuration
const dbConfig = {
  host: "db", // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};


const db = pgp(dbConfig);


// test your database
db.connect()
  .then((obj) => {
    console.log("Database connection successful"); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch((error) => {
    console.log("ERROR:", error.message || error);
  });


// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************


// Register `hbs` as our view engine using its bound `engine()` function.
app.engine("hbs", hbs.engine);
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.


// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);


app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

//to serve static files from resources folder
app.use('/resources', express.static('resources'));


// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************


// TODO - Include your API routes here
app.get('/welcome', (req, res) => {
  res.json({ status: 'success', message: 'Welcome!' });
});


app.get("/", (req, res) => {
  res.redirect("/login");
});


app.get("/login", (req, res) => {
  res.render("pages/login");
});


app.post('/login', async (req, res) => {
  //hash the password using bcrypt library
  const isTest = req.query.test;
  const query = 'SELECT * FROM users WHERE username = $1';
  const user = await db.oneOrNone(query, [req.body.username]);

  if (user) {
    const match = await bcrypt.compare(req.body.password, user.password);
    if (match) {
      //save user details in session like in lab 7
      if (isTest) {
        return res.status(200).json({
          message: 'Success',
        });
      } else {
        req.session.user = user;
        req.session.save();
        res.redirect('/newsMap');

        

      }
    }
    else {
      if (isTest) {
        return res.status(400).json({
          message: 'Invalid username or password.',
        });
      } else {
        res.render('pages/login', { error: true });
      }
    }
  }
  else {
    if (isTest) {
      return res.status(400).json({
        message: 'Invalid username or password.',
      });
    } else {
      res.render('pages/login', { error: true });
    }
  }
});


app.get("/register", (req, res) => {
  res.render("pages/register");
});


app.post('/register', async (req, res) => {
  const isTest = req.query.test;

  if (req.body.password != req.body.confirmpassword) {
    if (isTest) {
      return res.status(400).json({
        status: 'Failed',
        message: 'Passwords do not match',
      });
    } else {
      return res.render('pages/register', { no_match: true });
    }
  }
  else {
    const check_query = 'SELECT * FROM users WHERE username = $1 LIMIT 1';


    user_exists = await db.oneOrNone(check_query, [req.body.username]);


    if (user_exists) {
      if (isTest) {
        return res.status(400).json({
          message: 'User exists, please login',
        });
      } else {
        return res.render('pages/register', { user_exists: true });
      }
    }
    else {
      const insert_query = 'INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *';
      try {
        const hash = await bcrypt.hash(req.body.password, 10);
        const user = await db.one(insert_query, [req.body.username, hash])
        if (user) {
          if (isTest) {
            return res.status(200).json({
              message: 'Success',
            });
          }
          else {
            req.session.user = user;
            req.session.save();
            return res.redirect('/newsMap');
          }
        }
        else{
          req.session.user = user;
          req.session.save();
          const insertQuery = `INSERT INTO profiles (user_id, profile_picture, profile_description) VALUES ($1, '../../resources/images/defaultpp.png', 'No user description.');`;
          await db.none(insertQuery, [user.user_id]);
          return res.redirect('/newsMap');
        }
      }
      catch (err) {
        if (isTest) {
          return res.status(400).json({
            data: err,
            message: 'Invalid Input',
          });
        }
        else {
          return res.render('pages/register', { invalid_input: true });
        }
      }

    }
  }
});


// Authentication Middleware.
const auth = (req, res, next) => {
  if (!req.session.user) {
    // Default to login page.
    return res.status(302).redirect("/login");
  }
  next();
};


app.use(auth);

app.get("/newsSearch", auth, (req, res) => {
  res.render("pages/newsSearch", { local_news: [], location: "", message: "" });
});

app.post("/newsSearch", auth, async (req, res) => {


  const location = req.body.location || "New York, New York, United States"; 

  try {
    // Fetch local news from SerpAPI
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        engine: "google_news",
        q: location,
        api_key: process.env.NEWS_API_KEY
      }
    });


    const local_news = response.data.top_stories || response.data.news_results || [];

    // Sort news by date (by descending order, most recent first)
    local_news.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.render("pages/newsSearch", { local_news, location, message: "" });
  } catch (error) {
    console.error("Error fetching news:", error);
    res.render("pages/newsSearch", { local_news: [], location, message: "Failed to fetch news. Please try again later." });
  }
});


app.get("/Dummy", auth, async (req, res) => {
  const axios = require("axios");
  const location = "Austin, Texas, United States";


  try {
    const response = await axios.get("https://serpapi.com/search.json", {
      params: {
        q: "Live news",
        location: location,
        hl: "en",
        gl: "us",
        api_key: "2639dc1ea4d0ea48dbc78d2741a887f653723d0e8bb286c2380c2861503e721e"
      }
    });

    const local_news = response.data.organic_results || response.data.top_stories || [];

    res.render("pages/Dummy", { local_news, location, message: "" });
  } catch (error) {
    console.error("Error fetching news:", error);
    res.render("pages/Dummy", { local_news: [], location, message: "Failed to fetch news. Please try again later." });
  }
});

app.get("/newsMap", (req, res) => {
  const mapAPI = `https://maps.googleapis.com/maps/api/js?key=${process.env.MAP_API_KEY}&callback=console.debug&libraries=maps,marker&v=beta`


  res.render("pages/newsMap", { mapAPI });
});

app.post("/newsMap", (req, res) => {
  const insertArticleQuery = `
    INSERT INTO articles (title, a_date, author, thumbnail, link)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *;
  `;

  const insertArticleToUserQuery = `
    INSERT INTO articles_to_users (article_id, user_id)
    VALUES ($1, $2)
    RETURNING *;
  `;

  const { title, date: a_date, author, thumbnail, link } = req.body;
  const user_id = req.session.user.user_id;

  db.one(insertArticleQuery, [title, a_date, author, thumbnail, link])
    .then((article) => {
      return db.one(insertArticleToUserQuery, [article.article_id, user_id])
        .then((userArticle) => {
          res.status(200).json({
            message: "Article saved successfully!",
            article,
            userArticle,
          });
        });
    })
    .catch((error) => {
      console.error("Error saving article:", error);
      res.status(500).json({
        message: "Failed to save the article. Please try again later.",
        error,
      });
    });
});



app.get("/logout", (req, res) => {
 req.session.destroy();
 res.redirect("/login");
});

app.get("/savedArticlesTesting", auth, async (req, res) => {
  const user_id = req.session.user.user_id;

  // Query to fetch saved articles
  const savedArticlesQuery = `
    SELECT a.article_id, a.title, a.a_date, a.author, a.thumbnail, a.link
    FROM articles a
    INNER JOIN articles_to_users atu ON a.article_id = atu.article_id
    WHERE atu.user_id = $1
    ORDER BY a.a_date DESC;
  `;

  try {
    const savedArticles = await db.any(savedArticlesQuery, [user_id]);

    res.render("pages/savedarticles", {
      articles: savedArticles,
      user: req.session.user.username,
    });
  } catch (error) {
    console.error("Error fetching saved articles or comments:", error);

    res.render("pages/savedarticles", {
      articles: [],
      comments: [],
      user: req.session.user.username,
      message: "Failed to fetch saved articles or comments. Please try again later.",
    });
  }
});

app.get("/savedArticles", async (req, res) => {
  const get_articles = 
  `
    SELECT * 
    FROM articles 
    JOIN articles_to_users ON articles.article_id = articles_to_users.article_id
    JOIN users ON articles_to_users.user_id = users.user_id
    WHERE users.username = $1;
  `;

  const temp_insert = 
  `
    INSERT INTO articles_to_users (article_id, user_id)
    VALUES
      (1, 2),
      (2, 2),
      (3, 2),
      (4, 2),
      (5, 2);
 
  `;

  const temp_insert2 = 
  `
    SELECT * FROM articles_to_comments; 
  `;

  // db.any(temp_insert)
  // .then(function (data) {
  //   console.log("articles_to_users", data);
  // });
  // db.any(temp_insert2)
  //   .then(function (data) {
  //     console.log('articles_to_comments',data);
  //   });


  const articles = await db.any(get_articles, [req.session.user.username]);
    
    // Fetch comments for all articles concurrently
    const articlesWithComments = await Promise.all(
      articles.map(async (article) => {
        const get_comments = `
          SELECT *
          FROM comments
          INNER JOIN articles_to_comments ON comments.comment_id = articles_to_comments.comment_id
          WHERE articles_to_comments.article_id = $1;
        `;

        const comments = await db.any(get_comments, [article.article_id]);
        return {
          ...article,
          comments,
        };
      })
    );

    console.log('=================');
    console.log(articlesWithComments);
    console.log('=================');
    console.log(articlesWithComments[0]);
    console.log('=================');
    console.log(articlesWithComments[0].comments);
    console.log('=================');
    console.log(articlesWithComments[2].comments);
    console.log('=================');


  // db.any(get_articles, [req.session.user.username])
  //   .then(async function (data) {
  //     let final_articles = [];
  //     console.log('data', data.length);
  //     for(const article of data) {
  //       console.log('article id', article.article_id);
  //       const get_comments = 
  //       `
  //         SELECT *
  //         FROM comments
  //         INNER JOIN articles_to_comments ON comments.comment_id = articles_to_comments.comment_id
  //         WHERE articles_to_comments.article_id = $1;
  //       `;

  //       await db.any(get_comments, [article.article_id])
  //        .then(function (data) {
  //           //console.log(data);
  //           article.comments = data;
  //           final_articles.push(article);
  //           console.log(article);
  //       });

    
  //     }
      
  //     console.log(data);

    // });
  res.render("pages/savedarticles", { articles: articlesWithComments, user: req.session.user.username });
});

app.post("/savedArticles", async (req, res) => {

  if (req.body.comment) {      
    const add_comment = 'INSERT INTO COMMENTS (username,comment) VALUES ($1, $2) RETURNING *;';

    const parameters = [req.session.user.username, req.body.comment];
    const comment_added = await db.one(add_comment, parameters);

    db.any('SELECT * FROM COMMENTS')
    .then(function (data) {
      console.log(data);
    })

    const get_articles = 
    `
      SELECT * 
      FROM articles 
      JOIN articles_to_users ON articles.article_id = articles_to_users.article_id
      JOIN users ON articles_to_users.user_id = users.user_id
      WHERE users.username = $1;
    `;

    db.any(get_articles, [req.session.user.username])
      .then(function (data) {
        res.render("pages/savedarticles", { articles: data, user: req.session.user.username });
      })
    return;
    res.redirect('/savedArticles');
    return;
    
    if (comment_added) {
      db.any('SELECT * FROM COMMENTS')
        .then(function (data) {
          

        })
    }
  }
  else if(req.body.deleted_comment_id){
    const delete_query = 'DELETE FROM COMMENTS WHERE comment_id = $1 RETURNING *';
    const success = await db.oneOrNone(delete_query, [req.body.deleted_comment_id]);

    if (success) {
      db.any('SELECT * FROM COMMENTS')
        .then(function (data) {
          const comments = data;

          const mockData = [
            {
              thumbnail: "https://assets.teenvogue.com/photos/66ec282d6e5148b6c28841e5/1:1/w_3925,h_3925,c_limit/2173121723",
              title: "title Test 1",
              a_date: "2021-09-01",
              author: "Myung Test",
              comments: comments,
            },
            {
              thumbnail: "https://upload.wikimedia.org/wikipedia/commons/c/c2/240318_Lomon.jpg",
              title: "title Test 2",
              a_date: "2022-10-01",
              author: "Jeno Test",
              comments: comments,
            },
            {
              thumbnail: "https://www.rollingstone.com/wp-content/uploads/2022/09/GettyImages-1423491348.jpg?w=831&h=554&crop=1",
              title: "title Test 3",
              a_date: "2016-05-21",
              author: "Lomon Test",
              comments: comments,
            },
          ];
          res.status(200).render("pages/savedarticles", { articles: mockData, message: "Comment successfully added to article.", user: req.session.user.username});
        })
    }
  }
  else if(req.body.edit_comment_id_show){
      db.any('SELECT * FROM COMMENTS')
        .then(function (data) {
          const comments = data;

          const mockData = [
            {
              thumbnail: "https://assets.teenvogue.com/photos/66ec282d6e5148b6c28841e5/1:1/w_3925,h_3925,c_limit/2173121723",
              title: "title Test 1",
              a_date: "2021-09-01",
              author: "Myung Test",
              comments: comments,
            },
            {
              thumbnail: "https://upload.wikimedia.org/wikipedia/commons/c/c2/240318_Lomon.jpg",
              title: "title Test 2",
              a_date: "2022-10-01",
              author: "Jeno Test",
              comments: comments,
            },
            {
              thumbnail: "https://www.rollingstone.com/wp-content/uploads/2022/09/GettyImages-1423491348.jpg?w=831&h=554&crop=1",
              title: "title Test 3",
              a_date: "2016-05-21",
              author: "Lomon Test",
              comments: comments,
            },
          ];
          res.status(200).render("pages/savedarticles", { articles: mockData, message: "Comment successfully added to article.", user: req.session.user.username, edit_comment_id_show: req.body.edit_comment_id_show});
        })
    }
    else if(req.body.edited_comment_text){
      const update_query = 'UPDATE comments SET comment =$1 WHERE comment_id = $2 RETURNING *';
      const updated = await db.one(update_query,[req.body.edited_comment_text, req.body.edited_comment_id]);
      if(updated){
      db.any('SELECT * FROM COMMENTS')
        .then(function (data) {
          const comments = data;

          const mockData = [
            {
              thumbnail: "https://assets.teenvogue.com/photos/66ec282d6e5148b6c28841e5/1:1/w_3925,h_3925,c_limit/2173121723",
              title: "title Test 1",
              a_date: "2021-09-01",
              author: "Myung Test",
              comments: comments,
            },
            {
              thumbnail: "https://upload.wikimedia.org/wikipedia/commons/c/c2/240318_Lomon.jpg",
              title: "title Test 2",
              a_date: "2022-10-01",
              author: "Jeno Test",
              comments: comments,
            },
            {
              thumbnail: "https://www.rollingstone.com/wp-content/uploads/2022/09/GettyImages-1423491348.jpg?w=831&h=554&crop=1",
              title: "title Test 3",
              a_date: "2016-05-21",
              author: "Lomon Test",
              comments: comments,
            },
          ];
          res.status(200).render("pages/savedarticles", { articles: mockData, message: "Comment successfully added to article.", user: req.session.user.username });
        })
      }
    }
});

app.get("/profile", async (req, res) => {
  const user = req.session.user;

  if(!user){
    return res.render("pages/login", {message: "User not authenticated."});
  } 

  try{
    const retrieveQuery = `SELECT * FROM profiles WHERE user_id = $1`;
    const profile = await db.one(retrieveQuery, [user.user_id]);
    res.render("pages/profile", {user, profile});
  }
  catch(err){
    res.render("pages/login", {message: "Sorry we encountered an error."});
  }
});

app.post('/updateUser', async function (req, res) {
  const prevUser = req.session.user;
  const updateQuery1 = `UPDATE users SET username = $1 WHERE user_id = $2 RETURNING * ;`;
  const updateQuery2 = `UPDATE profiles SET profile_description = $1 WHERE user_id = $2 RETURNING *;`;
  const profile = await db.oneOrNone(updateQuery2, [req.body.description, prevUser.user_id]);
  const user = await db.oneOrNone(updateQuery1, [req.body.username, prevUser.user_id])
  if (user) {
    res.render("pages/profile", { user, profile });
  }
});

//route for getting data from courses dt and rendering the comment modal with it
// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
module.exports = app.listen(3000);
console.log("Server is listening on port 3000");